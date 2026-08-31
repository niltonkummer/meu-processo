begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_dispatcher') then
    create role app_dispatcher
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

alter table app_private.outbox_events
  add column claimed_by text,
  add column lease_token_hash bytea,
  add column leased_until timestamptz,
  add column last_attempt_at timestamptz,
  add column last_outcome_token_hash bytea,
  add column last_failure_code text,
  add column last_failed_at timestamptz,
  add constraint outbox_events_claimed_by_format check (
    claimed_by is null or claimed_by ~ '^[A-Za-z0-9._:-]{1,100}$'
  ),
  add constraint outbox_events_lease_hash_length check (
    lease_token_hash is null or octet_length(lease_token_hash) = 32
  ),
  add constraint outbox_events_outcome_hash_length check (
    last_outcome_token_hash is null
    or octet_length(last_outcome_token_hash) = 32
  ),
  add constraint outbox_events_failure_code_format check (
    last_failure_code is null
    or last_failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  add constraint outbox_events_lease_consistency check (
    (
      claimed_by is null
      and lease_token_hash is null
      and leased_until is null
    )
    or
    (
      status = 'pending'
      and claimed_by is not null
      and lease_token_hash is not null
      and leased_until is not null
      and last_attempt_at is not null
      and leased_until > last_attempt_at
    )
  ),
  add constraint outbox_events_tenant_event_unique
    unique (tenant_id, event_id);

create index outbox_events_expired_lease_idx
  on app_private.outbox_events(leased_until, event_id)
  where status = 'pending' and leased_until is not null;

create table app_private.consumer_inbox_receipts (
  consumer_name text not null
    check (consumer_name ~ '^[a-z][a-z0-9._:-]{1,99}$'),
  event_id uuid not null,
  tenant_id uuid not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  processed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (consumer_name, event_id),
  foreign key (tenant_id, event_id)
    references app_private.outbox_events(tenant_id, event_id)
);

create index consumer_inbox_receipts_tenant_processed_idx
  on app_private.consumer_inbox_receipts(tenant_id, processed_at, event_id);

alter table app_private.consumer_inbox_receipts enable row level security;
alter table app_private.consumer_inbox_receipts force row level security;

create policy dispatcher_migrator_inbox
  on app_private.consumer_inbox_receipts for all to app_migrator
  using (true) with check (true);

create function app_private.claim_outbox_event(
  p_worker_id text,
  p_now timestamptz,
  p_leased_until timestamptz,
  p_lease_token_hash bytea
)
returns table (
  event_id uuid,
  tenant_id uuid,
  event_type text,
  aggregate_type text,
  aggregate_id uuid,
  correlation_id uuid,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_now is null
     or p_leased_until is null
     or p_leased_until < p_now + interval '30 seconds'
     or p_leased_until > p_now + interval '15 minutes'
     or p_lease_token_hash is null
     or octet_length(p_lease_token_hash) <> 32 then
    raise exception 'invalid outbox claim' using errcode = '22023';
  end if;

  update app_private.outbox_events as expired
     set claimed_by = null,
         lease_token_hash = null,
         leased_until = null,
         updated_at = p_now
   where expired.status = 'pending'
     and expired.leased_until <= p_now;

  return query
  with candidate as (
    select pending.event_id
      from app_private.outbox_events as pending
     where pending.status = 'pending'
       and pending.available_at <= p_now
       and pending.leased_until is null
       and pending.attempt_count < 1000
     order by pending.available_at, pending.event_id
     for update skip locked
     limit 1
  )
  update app_private.outbox_events as claimed
     set claimed_by = p_worker_id,
         lease_token_hash = p_lease_token_hash,
         leased_until = p_leased_until,
         last_attempt_at = p_now,
         last_outcome_token_hash = null,
         last_failure_code = null,
         last_failed_at = null,
         attempt_count = claimed.attempt_count + 1,
         updated_at = p_now
    from candidate
   where claimed.event_id = candidate.event_id
  returning claimed.event_id,
            claimed.tenant_id,
            claimed.event_type,
            claimed.aggregate_type,
            claimed.aggregate_id,
            claimed.correlation_id,
            claimed.payload,
            claimed.attempt_count;
end
$$;

create function app_private.complete_outbox_event(
  p_event_id uuid,
  p_lease_token_hash bytea,
  p_published_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_event_id is null
     or p_lease_token_hash is null
     or octet_length(p_lease_token_hash) <> 32
     or p_published_at is null then
    raise exception 'invalid outbox completion' using errcode = '22023';
  end if;

  if exists (
    select 1
      from app_private.outbox_events as completed
     where completed.event_id = p_event_id
       and completed.status = 'published'
       and completed.last_outcome_token_hash = p_lease_token_hash
       and completed.published_at = p_published_at
  ) then
    return true;
  end if;

  update app_private.outbox_events as current_event
     set status = 'published',
         published_at = p_published_at,
         claimed_by = null,
         lease_token_hash = null,
         leased_until = null,
         last_outcome_token_hash = p_lease_token_hash,
         last_failure_code = null,
         last_failed_at = null,
         updated_at = p_published_at
   where current_event.event_id = p_event_id
     and current_event.status = 'pending'
     and current_event.lease_token_hash = p_lease_token_hash
     and p_published_at >= current_event.last_attempt_at
     and p_published_at <= current_event.leased_until;

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

create function app_private.fail_outbox_event(
  p_event_id uuid,
  p_lease_token_hash bytea,
  p_failed_at timestamptz,
  p_failure_code text,
  p_next_attempt_at timestamptz,
  p_terminal boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_event_id is null
     or p_lease_token_hash is null
     or octet_length(p_lease_token_hash) <> 32
     or p_failed_at is null
     or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
     or p_terminal is null
     or (p_terminal and p_next_attempt_at is not null)
     or (
       not p_terminal
       and (
         p_next_attempt_at is null
         or p_next_attempt_at < p_failed_at + interval '1 minute'
         or p_next_attempt_at > p_failed_at + interval '24 hours'
       )
     ) then
    raise exception 'invalid outbox failure' using errcode = '22023';
  end if;

  if exists (
    select 1
      from app_private.outbox_events as failed
     where failed.event_id = p_event_id
       and failed.last_outcome_token_hash = p_lease_token_hash
       and failed.last_failure_code = p_failure_code
       and failed.last_failed_at = p_failed_at
       and (
         (p_terminal and failed.status = 'dead')
         or
         (
           not p_terminal
           and failed.status = 'pending'
           and failed.leased_until is null
           and failed.available_at = p_next_attempt_at
         )
       )
  ) then
    return true;
  end if;

  update app_private.outbox_events as current_event
     set status = case when p_terminal then 'dead' else 'pending' end,
         available_at = case
           when p_terminal then current_event.available_at
           else p_next_attempt_at
         end,
         published_at = null,
         claimed_by = null,
         lease_token_hash = null,
         leased_until = null,
         last_outcome_token_hash = p_lease_token_hash,
         last_failure_code = p_failure_code,
         last_failed_at = p_failed_at,
         updated_at = p_failed_at
   where current_event.event_id = p_event_id
     and current_event.status = 'pending'
     and current_event.lease_token_hash = p_lease_token_hash
     and p_failed_at >= current_event.last_attempt_at
     and p_failed_at <= current_event.leased_until;

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

revoke all on table app_private.consumer_inbox_receipts
  from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.claim_outbox_event(
  text, timestamptz, timestamptz, bytea
) from public, app_runtime, app_worker;
revoke all on function app_private.complete_outbox_event(
  uuid, bytea, timestamptz
) from public, app_runtime, app_worker;
revoke all on function app_private.fail_outbox_event(
  uuid, bytea, timestamptz, text, timestamptz, boolean
) from public, app_runtime, app_worker;

grant usage on schema app_private to app_dispatcher;
grant execute on function app_private.claim_outbox_event(
  text, timestamptz, timestamptz, bytea
) to app_dispatcher;
grant execute on function app_private.complete_outbox_event(
  uuid, bytea, timestamptz
) to app_dispatcher;
grant execute on function app_private.fail_outbox_event(
  uuid, bytea, timestamptz, text, timestamptz, boolean
) to app_dispatcher;

reset role;

commit;
