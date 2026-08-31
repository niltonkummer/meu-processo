begin;

do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'app_billing_webhook'
  ) then
    create role app_billing_webhook
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end
$$;

set role app_migrator;

grant usage on schema app_private to app_billing_webhook;

create table app_private.billing_customers (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  provider text not null check (provider = 'stripe'),
  provider_customer_ref text not null unique
    check (provider_customer_ref ~ '^cus_[A-Za-z0-9]{8,255}$'),
  livemode boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, provider),
  unique (tenant_id, provider, provider_customer_ref),
  check (updated_at >= created_at)
);

create table app_private.billing_subscriptions (
  tenant_id uuid not null,
  provider text not null check (provider = 'stripe'),
  provider_subscription_ref text not null
    check (provider_subscription_ref ~ '^sub_[A-Za-z0-9]{8,255}$'),
  provider_customer_ref text not null,
  offer_code text not null check (offer_code = 'person'),
  status text not null check (
    status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
      'canceled', 'unpaid', 'paused'
    )
  ),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  provider_event_created_at timestamptz not null,
  provider_event_ref text not null
    check (provider_event_ref ~ '^evt_[A-Za-z0-9]{8,255}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, provider_subscription_ref),
  unique (provider, provider_subscription_ref),
  foreign key (tenant_id, provider, provider_customer_ref)
    references app_private.billing_customers(
      tenant_id, provider, provider_customer_ref
    ),
  check (current_period_end > current_period_start),
  check (updated_at >= created_at)
);

create index billing_subscriptions_current_idx
  on app_private.billing_subscriptions(tenant_id, current_period_end desc)
  where status in ('trialing', 'active', 'past_due');

create table app_private.billing_events (
  provider text not null check (provider = 'stripe'),
  provider_event_ref text not null
    check (provider_event_ref ~ '^evt_[A-Za-z0-9]{8,255}$'),
  event_type text not null check (
    event_type in (
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    )
  ),
  livemode boolean not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  tenant_id uuid references app_private.tenants(tenant_id),
  provider_customer_ref text not null
    check (provider_customer_ref ~ '^cus_[A-Za-z0-9]{8,255}$'),
  provider_subscription_ref text not null
    check (provider_subscription_ref ~ '^sub_[A-Za-z0-9]{8,255}$'),
  processing_status text not null
    check (processing_status in ('processed', 'ignored', 'stale')),
  provider_created_at timestamptz not null,
  received_at timestamptz not null,
  processed_at timestamptz not null,
  primary key (provider, provider_event_ref),
  check (processed_at >= received_at)
);

create index billing_events_tenant_received_idx
  on app_private.billing_events(tenant_id, received_at desc)
  where tenant_id is not null;

create table app_private.checkout_attempts (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  request_id uuid not null,
  offer_code text not null check (offer_code = 'person'),
  status text not null check (status in ('reserved', 'created', 'expired')),
  provider_session_ref text unique check (
    provider_session_ref is null
    or provider_session_ref ~ '^cs_(test|live)_[A-Za-z0-9]{8,255}$'
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (tenant_id, request_id),
  check (expires_at > created_at),
  check (updated_at >= created_at),
  check (
    (status = 'reserved' and provider_session_ref is null)
    or (status = 'created' and provider_session_ref is not null)
    or status = 'expired'
  )
);

create index checkout_attempts_expiry_idx
  on app_private.checkout_attempts(expires_at, tenant_id, request_id)
  where status in ('reserved', 'created');

alter table app_private.billing_customers enable row level security;
alter table app_private.billing_customers force row level security;
alter table app_private.billing_subscriptions enable row level security;
alter table app_private.billing_subscriptions force row level security;
alter table app_private.billing_events enable row level security;
alter table app_private.billing_events force row level security;
alter table app_private.checkout_attempts enable row level security;
alter table app_private.checkout_attempts force row level security;

create policy billing_migrator_customers
  on app_private.billing_customers for all to app_migrator
  using (true) with check (true);
create policy billing_migrator_subscriptions
  on app_private.billing_subscriptions for all to app_migrator
  using (true) with check (true);
create policy billing_migrator_events
  on app_private.billing_events for all to app_migrator
  using (true) with check (true);
create policy billing_migrator_checkout
  on app_private.checkout_attempts for all to app_migrator
  using (true) with check (true);

create function app_private.get_tenant_billing_state()
returns table (
  provider_customer_ref text,
  provider_subscription_ref text,
  offer_code text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_user_id uuid := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
begin
  if current_user_id is null or current_tenant_id is null or not exists (
    select 1
      from app_private.tenants tenant
      join app_private.tenant_members member
        on member.tenant_id=tenant.tenant_id
       and member.user_id=current_user_id
       and member.active=true
     where tenant.tenant_id=current_tenant_id
       and tenant.status='active'
  ) then
    raise exception 'billing membership denied' using errcode='42501';
  end if;

  return query
  select customer.provider_customer_ref,
         subscription.provider_subscription_ref,
         subscription.offer_code,
         subscription.status,
         subscription.current_period_start,
         subscription.current_period_end,
         subscription.cancel_at_period_end
    from app_private.billing_customers customer
    join app_private.tenants tenant on tenant.tenant_id=customer.tenant_id
    join app_private.tenant_members member
      on member.tenant_id=customer.tenant_id
     and member.user_id=current_user_id
     and member.active=true
    left join lateral (
      select item.*
        from app_private.billing_subscriptions item
       where item.tenant_id=customer.tenant_id
         and item.provider=customer.provider
       order by item.provider_event_created_at desc,
                item.provider_event_ref desc
       limit 1
    ) subscription on true
   where customer.tenant_id=current_tenant_id
     and customer.provider='stripe'
     and tenant.status='active';
end
$$;

create function app_private.bind_tenant_billing_customer(
  p_provider text,
  p_provider_customer_ref text,
  p_livemode boolean,
  p_created_at timestamptz
)
returns table (outcome text, provider_customer_ref text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  existing app_private.billing_customers%rowtype;
begin
  if current_user_id is null or current_tenant_id is null
     or p_provider <> 'stripe'
     or p_provider_customer_ref !~ '^cus_[A-Za-z0-9]{8,255}$'
     or p_created_at is null then
    raise exception 'invalid billing customer binding' using errcode='22023';
  end if;
  if not exists (
    select 1 from app_private.tenants tenant
    join app_private.tenant_members member
      on member.tenant_id=tenant.tenant_id
     and member.user_id=current_user_id
     and member.active=true
    where tenant.tenant_id=current_tenant_id and tenant.status='active'
  ) then
    raise exception 'billing membership denied' using errcode='42501';
  end if;

  select * into existing from app_private.billing_customers customer
   where customer.tenant_id=current_tenant_id
     and customer.provider=p_provider;
  if found then
    if existing.provider_customer_ref <> p_provider_customer_ref
       or existing.livemode <> p_livemode then
      raise exception 'billing customer conflict' using errcode='23505';
    end if;
    return query select 'existing'::text, existing.provider_customer_ref;
    return;
  end if;

  insert into app_private.billing_customers(
    tenant_id, provider, provider_customer_ref, livemode, created_at, updated_at
  ) values (
    current_tenant_id, p_provider, p_provider_customer_ref, p_livemode,
    p_created_at, p_created_at
  );
  return query select 'created'::text, p_provider_customer_ref;
end
$$;

create function app_private.reserve_tenant_checkout_attempt(
  p_request_id uuid,
  p_offer_code text,
  p_now timestamptz
)
returns table (
  outcome text,
  provider_customer_ref text,
  provider_session_ref text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  customer_ref text;
  attempt app_private.checkout_attempts%rowtype;
begin
  if current_user_id is null or current_tenant_id is null
     or p_request_id is null or p_offer_code <> 'person' or p_now is null then
    raise exception 'invalid checkout reservation' using errcode='22023';
  end if;
  select customer.provider_customer_ref into customer_ref
    from app_private.billing_customers customer
    join app_private.tenants tenant on tenant.tenant_id=customer.tenant_id
    join app_private.tenant_members member
      on member.tenant_id=customer.tenant_id
     and member.user_id=current_user_id and member.active=true
   where customer.tenant_id=current_tenant_id
     and customer.provider='stripe' and tenant.status='active';
  if customer_ref is null then
    raise exception 'billing customer unavailable' using errcode='42501';
  end if;

  insert into app_private.checkout_attempts(
    tenant_id, request_id, offer_code, status,
    created_at, updated_at, expires_at
  ) values (
    current_tenant_id, p_request_id, p_offer_code, 'reserved',
    p_now, p_now, p_now + interval '30 minutes'
  ) on conflict (tenant_id, request_id) do nothing;

  select * into attempt from app_private.checkout_attempts item
   where item.tenant_id=current_tenant_id and item.request_id=p_request_id;
  if attempt.offer_code <> p_offer_code then
    raise exception 'checkout request conflict' using errcode='23505';
  end if;
  if attempt.expires_at <= p_now and attempt.status <> 'expired' then
    update app_private.checkout_attempts item set
      status='expired', updated_at=p_now
    where item.tenant_id=current_tenant_id and item.request_id=p_request_id;
    attempt.status := 'expired';
    attempt.updated_at := p_now;
  end if;
  return query select attempt.status, customer_ref,
    attempt.provider_session_ref, attempt.expires_at;
end
$$;

create function app_private.complete_tenant_checkout_attempt(
  p_request_id uuid,
  p_provider_session_ref text,
  p_completed_at timestamptz,
  p_expires_at timestamptz
)
returns table (outcome text, provider_session_ref text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  attempt app_private.checkout_attempts%rowtype;
begin
  if current_user_id is null or current_tenant_id is null
     or p_request_id is null
     or p_provider_session_ref !~ '^cs_(test|live)_[A-Za-z0-9]{8,255}$'
     or p_completed_at is null or p_expires_at is null
     or p_expires_at <= p_completed_at
     or p_expires_at > p_completed_at + interval '24 hours' then
    raise exception 'invalid checkout completion' using errcode='22023';
  end if;
  if not exists (
    select 1 from app_private.tenant_members member
     where member.tenant_id=current_tenant_id
       and member.user_id=current_user_id and member.active=true
  ) then
    raise exception 'billing membership denied' using errcode='42501';
  end if;
  select * into attempt from app_private.checkout_attempts item
   where item.tenant_id=current_tenant_id and item.request_id=p_request_id
   for update;
  if not found or attempt.status='expired' or attempt.expires_at <= p_completed_at then
    raise exception 'checkout attempt unavailable' using errcode='22023';
  end if;
  if attempt.status='created' then
    if attempt.provider_session_ref <> p_provider_session_ref then
      raise exception 'checkout completion conflict' using errcode='23505';
    end if;
    return query select 'existing'::text,
      attempt.provider_session_ref, attempt.expires_at;
    return;
  end if;
  update app_private.checkout_attempts item set
    status='created', provider_session_ref=p_provider_session_ref,
    updated_at=p_completed_at, expires_at=p_expires_at
   where item.tenant_id=current_tenant_id and item.request_id=p_request_id;
  return query select 'created'::text, p_provider_session_ref, p_expires_at;
end
$$;

create function app_private.apply_billing_subscription_event(
  p_provider_event_ref text,
  p_event_type text,
  p_livemode boolean,
  p_payload_hash bytea,
  p_provider_customer_ref text,
  p_provider_subscription_ref text,
  p_offer_code text,
  p_subscription_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_provider_created_at timestamptz,
  p_received_at timestamptz
)
returns table (outcome text, tenant_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_tenant_id uuid;
  affected_rows integer := 0;
begin
  if p_provider_event_ref !~ '^evt_[A-Za-z0-9]{8,255}$'
     or p_event_type not in (
       'customer.subscription.created',
       'customer.subscription.updated',
       'customer.subscription.deleted'
     )
     or p_payload_hash is null or octet_length(p_payload_hash) <> 32
     or p_provider_customer_ref !~ '^cus_[A-Za-z0-9]{8,255}$'
     or p_provider_subscription_ref !~ '^sub_[A-Za-z0-9]{8,255}$'
     or p_offer_code <> 'person'
     or p_subscription_status not in (
       'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
       'canceled', 'unpaid', 'paused'
     )
     or p_current_period_start is null or p_current_period_end is null
     or p_current_period_end <= p_current_period_start
     or p_provider_created_at is null or p_received_at is null
     or (p_event_type='customer.subscription.deleted'
         and p_subscription_status <> 'canceled') then
    raise exception 'invalid billing event' using errcode='22023';
  end if;

  if exists (
    select 1 from app_private.billing_events event
     where event.provider='stripe'
       and event.provider_event_ref=p_provider_event_ref
  ) then
    return query select 'duplicate'::text,
      (select event.tenant_id from app_private.billing_events event
        where event.provider='stripe'
          and event.provider_event_ref=p_provider_event_ref);
    return;
  end if;

  select customer.tenant_id into resolved_tenant_id
    from app_private.billing_customers customer
   where customer.provider='stripe'
     and customer.provider_customer_ref=p_provider_customer_ref
     and customer.livemode=p_livemode;

  if resolved_tenant_id is null then
    insert into app_private.billing_events(
      provider, provider_event_ref, event_type, livemode, payload_hash,
      tenant_id, provider_customer_ref, provider_subscription_ref,
      processing_status, provider_created_at, received_at, processed_at
    ) values (
      'stripe', p_provider_event_ref, p_event_type, p_livemode, p_payload_hash,
      null, p_provider_customer_ref, p_provider_subscription_ref,
      'ignored', p_provider_created_at, p_received_at, p_received_at
    );
    return query select 'ignored'::text, null::uuid;
    return;
  end if;

  insert into app_private.billing_subscriptions(
    tenant_id, provider, provider_subscription_ref, provider_customer_ref,
    offer_code, status, current_period_start, current_period_end,
    cancel_at_period_end, provider_event_created_at, provider_event_ref,
    created_at, updated_at
  ) values (
    resolved_tenant_id, 'stripe', p_provider_subscription_ref,
    p_provider_customer_ref, p_offer_code, p_subscription_status,
    p_current_period_start, p_current_period_end, p_cancel_at_period_end,
    p_provider_created_at, p_provider_event_ref, p_received_at, p_received_at
  )
  on conflict on constraint billing_subscriptions_pkey do update set
    offer_code=excluded.offer_code,
    status=excluded.status,
    current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,
    provider_event_created_at=excluded.provider_event_created_at,
    provider_event_ref=excluded.provider_event_ref,
    updated_at=excluded.updated_at
  where (
    excluded.provider_event_created_at,
    excluded.provider_event_ref
  ) > (
    billing_subscriptions.provider_event_created_at,
    billing_subscriptions.provider_event_ref
  );
  get diagnostics affected_rows = row_count;

  insert into app_private.billing_events(
    provider, provider_event_ref, event_type, livemode, payload_hash,
    tenant_id, provider_customer_ref, provider_subscription_ref,
    processing_status, provider_created_at, received_at, processed_at
  ) values (
    'stripe', p_provider_event_ref, p_event_type, p_livemode, p_payload_hash,
    resolved_tenant_id, p_provider_customer_ref, p_provider_subscription_ref,
    case when affected_rows > 0 then 'processed' else 'stale' end,
    p_provider_created_at, p_received_at, p_received_at
  );
  return query select case when affected_rows > 0 then 'applied' else 'stale' end,
    resolved_tenant_id;
end
$$;

revoke all on app_private.billing_customers,
  app_private.billing_subscriptions,
  app_private.billing_events,
  app_private.checkout_attempts
from public, app_runtime, app_worker, app_dispatcher, app_document_worker,
  app_lifecycle_worker, app_billing_webhook;

revoke all on function app_private.get_tenant_billing_state() from public;
revoke all on function app_private.bind_tenant_billing_customer(
  text, text, boolean, timestamptz
) from public;
revoke all on function app_private.reserve_tenant_checkout_attempt(
  uuid, text, timestamptz
) from public;
revoke all on function app_private.complete_tenant_checkout_attempt(
  uuid, text, timestamptz, timestamptz
) from public;
revoke all on function app_private.apply_billing_subscription_event(
  text, text, boolean, bytea, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz
) from public;

grant execute on function app_private.get_tenant_billing_state()
  to app_runtime;
grant execute on function app_private.bind_tenant_billing_customer(
  text, text, boolean, timestamptz
) to app_runtime;
grant execute on function app_private.reserve_tenant_checkout_attempt(
  uuid, text, timestamptz
) to app_runtime;
grant execute on function app_private.complete_tenant_checkout_attempt(
  uuid, text, timestamptz, timestamptz
) to app_runtime;
grant execute on function app_private.apply_billing_subscription_event(
  text, text, boolean, bytea, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz
) to app_billing_webhook;

reset role;
commit;
