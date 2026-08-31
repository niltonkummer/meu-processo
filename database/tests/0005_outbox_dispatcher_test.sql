begin;

create extension if not exists pgtap;
select no_plan();

select ok(
  exists (select 1 from pg_roles where rolname = 'app_dispatcher'),
  'dispatcher role exists'
);
select ok(
  not (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolinherit
         from pg_roles where rolname = 'app_dispatcher'),
  'dispatcher role has no administration, inheritance or RLS bypass'
);
select has_table(
  'app_private', 'consumer_inbox_receipts', 'consumer inbox receipts exist'
);
select has_function(
  'app_private',
  'claim_outbox_event',
  array['text', 'timestamp with time zone', 'timestamp with time zone', 'bytea'],
  'outbox claim function exists'
);
select has_function(
  'app_private',
  'complete_outbox_event',
  array['uuid', 'bytea', 'timestamp with time zone'],
  'outbox completion function exists'
);
select has_function(
  'app_private',
  'fail_outbox_event',
  array[
    'uuid', 'bytea', 'timestamp with time zone', 'text',
    'timestamp with time zone', 'boolean'
  ],
  'outbox failure function exists'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in (
      'app_private.outbox_events'::regclass,
      'app_private.consumer_inbox_receipts'::regclass
    )),
  'outbox and inbox enable and force RLS'
);
select col_is_pk(
  'app_private', 'consumer_inbox_receipts',
  array['consumer_name', 'event_id'],
  'inbox deduplicates each event per consumer'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'app_private.consumer_inbox_receipts'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) like '%event_id%outbox_events%'
  ),
  'inbox receipt references a real outbox event'
);
select ok(
  not has_table_privilege(
    'app_dispatcher', 'app_private.outbox_events',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_dispatcher', 'app_private.consumer_inbox_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.consumer_inbox_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_runtime', 'app_private.consumer_inbox_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'runtime roles have no direct outbox or inbox table access'
);
select ok(
  has_function_privilege(
    'app_dispatcher',
    'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  )
  and has_function_privilege(
    'app_dispatcher',
    'app_private.complete_outbox_event(uuid,bytea,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'app_dispatcher',
    'app_private.fail_outbox_event(uuid,bytea,timestamptz,text,timestamptz,boolean)',
    'EXECUTE'
  ),
  'dispatcher can execute only the narrow command surface'
);
select ok(
  not has_function_privilege(
    'app_worker',
    'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_runtime',
    'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  ),
  'worker and API cannot dispatch cross-tenant events'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null)
     from pg_proc
    where oid in (
      'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)'::regprocedure,
      'app_private.complete_outbox_event(uuid,bytea,timestamptz)'::regprocedure,
      'app_private.fail_outbox_event(uuid,bytea,timestamptz,text,timestamptz,boolean)'::regprocedure
    )),
  'dispatcher functions are security definer with fixed configuration'
);

insert into app_private.user_accounts (user_id, provider_subject)
values (
  '00000000-0000-7000-8000-000000000081',
  'provider-outbox-dispatcher-synthetic'
);
insert into app_private.tenants (
  tenant_id, tenant_kind, personal_owner_user_id
) values (
  '10000000-0000-7000-8000-000000000081',
  'personal',
  '00000000-0000-7000-8000-000000000081'
);

insert into app_private.outbox_events (
  event_id, tenant_id, event_type, aggregate_type, aggregate_id,
  correlation_id, payload, available_at
) values
(
  '90000000-0000-7000-8000-000000000081',
  '10000000-0000-7000-8000-000000000081',
  'monitoring.completed.v1', 'monitoring_target',
  '20000000-0000-7000-8000-000000000081',
  '30000000-0000-7000-8000-000000000081',
  '{"executionId":"80000000-0000-7000-8000-000000000081"}',
  '2026-08-31T12:00:00Z'
),
(
  '90000000-0000-7000-8000-000000000082',
  '10000000-0000-7000-8000-000000000081',
  'monitoring.failed.v1', 'monitoring_target',
  '20000000-0000-7000-8000-000000000082',
  '30000000-0000-7000-8000-000000000082',
  '{"executionId":"80000000-0000-7000-8000-000000000082"}',
  '2026-08-31T13:00:00Z'
),
(
  '90000000-0000-7000-8000-000000000083',
  '10000000-0000-7000-8000-000000000081',
  'monitoring.completed.v1', 'monitoring_target',
  '20000000-0000-7000-8000-000000000083',
  '30000000-0000-7000-8000-000000000083',
  '{"executionId":"80000000-0000-7000-8000-000000000083"}',
  '2026-08-31T12:00:01Z'
);

set role app_dispatcher_local;

select results_eq(
  $$
    select event_id::text, attempt_count
      from app_private.claim_outbox_event(
        'dispatcher-a', '2026-08-31T12:00:00Z',
        '2026-08-31T12:01:00Z', decode(repeat('11', 32), 'hex')
      )
  $$,
  $$ values ('90000000-0000-7000-8000-000000000081'::text, 1) $$,
  'oldest due event is claimed and attempt is incremented'
);
select is_empty(
  $$
    select event_id
      from app_private.claim_outbox_event(
        'dispatcher-b', '2026-08-31T12:00:00Z',
        '2026-08-31T12:01:00Z', decode(repeat('22', 32), 'hex')
      )
     where event_id = '90000000-0000-7000-8000-000000000081'
  $$,
  'a live lease cannot be claimed twice'
);
select ok(
  not app_private.complete_outbox_event(
    '90000000-0000-7000-8000-000000000081',
    decode(repeat('99', 32), 'hex'), '2026-08-31T12:00:30Z'
  ),
  'wrong lease token cannot acknowledge publication'
);
select ok(
  app_private.complete_outbox_event(
    '90000000-0000-7000-8000-000000000081',
    decode(repeat('11', 32), 'hex'), '2026-08-31T12:00:30Z'
  ),
  'current lease token acknowledges publication'
);
select ok(
  app_private.complete_outbox_event(
    '90000000-0000-7000-8000-000000000081',
    decode(repeat('11', 32), 'hex'), '2026-08-31T12:00:30Z'
  ),
  'duplicate publication acknowledgement is idempotent'
);

select results_eq(
  $$
    select event_id::text, attempt_count
      from app_private.claim_outbox_event(
        'dispatcher-a', '2026-08-31T12:00:01Z',
        '2026-08-31T12:00:31Z', decode(repeat('33', 32), 'hex')
      )
  $$,
  $$ values ('90000000-0000-7000-8000-000000000083'::text, 1) $$,
  'next due event is claimed without waiting for a future event'
);
select ok(
  app_private.fail_outbox_event(
    '90000000-0000-7000-8000-000000000083',
    decode(repeat('33', 32), 'hex'), '2026-08-31T12:00:15Z',
    'OUTBOX_PUBLISH_FAILED', '2026-08-31T12:02:00Z', false
  ),
  'failed delivery is rescheduled'
);
select ok(
  app_private.fail_outbox_event(
    '90000000-0000-7000-8000-000000000083',
    decode(repeat('33', 32), 'hex'), '2026-08-31T12:00:15Z',
    'OUTBOX_PUBLISH_FAILED', '2026-08-31T12:02:00Z', false
  ),
  'duplicate failure acknowledgement is idempotent'
);
select is_empty(
  $$
    select event_id
      from app_private.claim_outbox_event(
        'dispatcher-b', '2026-08-31T12:01:59Z',
        '2026-08-31T12:02:29Z', decode(repeat('44', 32), 'hex')
      )
  $$,
  'retry and future events are not claimed early'
);
select results_eq(
  $$
    select event_id::text, attempt_count
      from app_private.claim_outbox_event(
        'dispatcher-b', '2026-08-31T12:02:00Z',
        '2026-08-31T12:02:30Z', decode(repeat('44', 32), 'hex')
      )
  $$,
  $$ values ('90000000-0000-7000-8000-000000000083'::text, 2) $$,
  'retry preserves event id and increments attempt'
);
select ok(
  not app_private.fail_outbox_event(
    '90000000-0000-7000-8000-000000000083',
    decode(repeat('33', 32), 'hex'), '2026-08-31T12:00:15Z',
    'OUTBOX_PUBLISH_FAILED', '2026-08-31T12:02:00Z', false
  ),
  'stale failure token is rejected after a new claim'
);
select ok(
  app_private.fail_outbox_event(
    '90000000-0000-7000-8000-000000000083',
    decode(repeat('44', 32), 'hex'), '2026-08-31T12:02:10Z',
    'OUTBOX_PUBLISH_FAILED', null, true
  ),
  'terminal failure moves the event to dead'
);
select ok(
  app_private.fail_outbox_event(
    '90000000-0000-7000-8000-000000000083',
    decode(repeat('44', 32), 'hex'), '2026-08-31T12:02:10Z',
    'OUTBOX_PUBLISH_FAILED', null, true
  ),
  'duplicate terminal failure is idempotent'
);

reset role;

select is(
  (select status from app_private.outbox_events
    where event_id = '90000000-0000-7000-8000-000000000081'),
  'published',
  'successful event is published'
);
select is(
  (select status from app_private.outbox_events
    where event_id = '90000000-0000-7000-8000-000000000083'),
  'dead',
  'terminal event is dead'
);
select is(
  (select attempt_count from app_private.outbox_events
    where event_id = '90000000-0000-7000-8000-000000000083'),
  2,
  'attempt count changes only on claim'
);
select is(
  (select status from app_private.outbox_events
    where event_id = '90000000-0000-7000-8000-000000000082'),
  'pending',
  'future event remains pending'
);

select * from finish();
rollback;
