begin;
create extension if not exists pgtap;
select no_plan();

select ok(
  exists (select 1 from pg_roles where rolname='app_billing_webhook')
  and not (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolinherit
             from pg_roles where rolname='app_billing_webhook'),
  'billing webhook role has no administration, inheritance or RLS bypass'
);

select has_table('app_private', 'billing_customers', 'tenant customer bindings exist');
select has_table('app_private', 'billing_subscriptions', 'subscription projection exists');
select has_table('app_private', 'billing_events', 'webhook inbox exists');
select has_table('app_private', 'checkout_attempts', 'checkout idempotency exists');

select col_is_pk(
  'app_private', 'billing_customers', array['tenant_id', 'provider'],
  'customer binding is tenant and provider scoped'
);
select col_is_pk(
  'app_private', 'billing_subscriptions', array['tenant_id', 'provider_subscription_ref'],
  'subscription identity is tenant scoped'
);
select col_is_pk(
  'app_private', 'checkout_attempts', array['tenant_id', 'request_id'],
  'checkout request is tenant scoped'
);
select col_is_pk(
  'app_private', 'billing_events', array['provider', 'provider_event_ref'],
  'provider event is globally idempotent per provider'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in (
      'app_private.billing_customers'::regclass,
      'app_private.billing_subscriptions'::regclass,
      'app_private.billing_events'::regclass,
      'app_private.checkout_attempts'::regclass
    )),
  'all billing tables enable and force RLS'
);

select has_function(
  'app_private', 'get_tenant_billing_state', array[]::text[],
  'runtime can read a minimized billing projection'
);
select has_function(
  'app_private', 'bind_tenant_billing_customer',
  array['text', 'text', 'boolean', 'timestamp with time zone'],
  'runtime can idempotently bind its provider customer'
);
select has_function(
  'app_private', 'reserve_tenant_checkout_attempt',
  array['uuid', 'text', 'timestamp with time zone'],
  'runtime can reserve a tenant checkout request'
);
select has_function(
  'app_private', 'complete_tenant_checkout_attempt',
  array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone'],
  'runtime can store the opaque checkout session reference'
);
select has_function(
  'app_private', 'apply_billing_subscription_event',
  array[
    'text', 'text', 'boolean', 'bytea', 'text', 'text', 'text', 'text',
    'timestamp with time zone', 'timestamp with time zone', 'boolean',
    'timestamp with time zone', 'timestamp with time zone'
  ],
  'billing webhook can atomically apply a canonical subscription event'
);

select ok(
  not has_table_privilege(
    'app_runtime', 'app_private.billing_customers',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_billing_webhook', 'app_private.billing_customers',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'application roles have no direct billing table access'
);

select ok(
  has_function_privilege('app_runtime', 'app_private.get_tenant_billing_state()', 'EXECUTE')
  and has_function_privilege(
    'app_runtime',
    'app_private.reserve_tenant_checkout_attempt(uuid,text,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_billing_webhook',
    'app_private.reserve_tenant_checkout_attempt(uuid,text,timestamptz)',
    'EXECUTE'
  ),
  'only API runtime receives tenant checkout commands'
);

select ok(
  has_function_privilege(
    'app_billing_webhook',
    'app_private.apply_billing_subscription_event(text,text,boolean,bytea,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_runtime',
    'app_private.apply_billing_subscription_event(text,text,boolean,bytea,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'only dedicated webhook role applies provider events'
);

select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""'])
     from pg_proc
    where oid in (
      'app_private.get_tenant_billing_state()'::regprocedure,
      'app_private.bind_tenant_billing_customer(text,text,boolean,timestamptz)'::regprocedure,
      'app_private.reserve_tenant_checkout_attempt(uuid,text,timestamptz)'::regprocedure,
      'app_private.complete_tenant_checkout_attempt(uuid,text,timestamptz,timestamptz)'::regprocedure,
      'app_private.apply_billing_subscription_event(text,text,boolean,bytea,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz)'::regprocedure
    )),
  'all billing commands are security definer with empty search path'
);

select ok(
  exists (
    select 1 from pg_indexes
     where schemaname='app_private'
       and indexname='billing_subscriptions_current_idx'
       and indexdef like '%tenant_id, current_period_end%'
  ),
  'current tenant subscription lookup is indexed'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname='app_private'
       and indexname='checkout_attempts_expiry_idx'
       and indexdef like '%expires_at%'
  ),
  'expirable checkout attempts use a partial index'
);

select * from finish();
rollback;
