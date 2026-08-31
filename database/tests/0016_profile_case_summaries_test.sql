begin;
create extension if not exists pgtap;
select no_plan();

select has_function(
  'app_private', 'list_monitored_subject_summaries',
  array['uuid', 'integer', 'boolean'],
  'bounded tenant profile summary projection exists'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'app_private.list_monitored_subject_summaries(uuid,integer,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_worker',
    'app_private.list_monitored_subject_summaries(uuid,integer,boolean)',
    'EXECUTE'
  ),
  'only the API runtime receives the profile summary projection'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
     from pg_proc
    where oid =
      'app_private.list_monitored_subject_summaries(uuid,integer,boolean)'::regprocedure),
  'profile summary projection is security definer with empty search path'
);

insert into app_private.user_accounts(user_id, provider_subject) values
  ('00000000-0000-7000-8000-000000000951', 'profile-summary-owner'),
  ('00000000-0000-7000-8000-000000000952', 'profile-summary-outsider');
insert into app_private.tenants(
  tenant_id, tenant_kind, personal_owner_user_id
) values (
  '10000000-0000-7000-8000-000000000951', 'personal',
  '00000000-0000-7000-8000-000000000951'
);
insert into app_private.tenant_members(
  tenant_id, user_id, membership_role
) values (
  '10000000-0000-7000-8000-000000000951',
  '00000000-0000-7000-8000-000000000951', 'owner'
);
insert into app_private.monitored_subjects(
  tenant_id, subject_id, subject_type, display_label,
  protected_reference, encrypted_value, key_version
) values
  (
    '10000000-0000-7000-8000-000000000951',
    '20000000-0000-7000-8000-000000000951', 'name', 'S. O.',
    'hmac-sha256:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'aes-256-gcm:v1:AAAAAAAAAAAAAAAA:BBBB:CCCCCCCCCCCCCCCCCCCCCC', 'v1'
  ),
  (
    '10000000-0000-7000-8000-000000000951',
    '20000000-0000-7000-8000-000000000952', 'name', 'S. V.',
    'hmac-sha256:v1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'aes-256-gcm:v1:AAAAAAAAAAAAAAAA:CCCC:DDDDDDDDDDDDDDDDDDDDDD', 'v1'
  );

insert into app_private.case_records(
  tenant_id, case_id, cnj_normalized, tribunal_code,
  first_seen_at, last_projected_at
) values
  ('10000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000951','0000001-23.2026.8.99.0001','TJEX','2026-08-25T10:00Z','2026-08-31T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000952','0000002-23.2026.8.99.0001','TJEX','2026-08-25T10:00Z','2026-08-30T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000953','0000003-23.2026.8.99.0001','TJEX','2026-08-25T10:00Z','2026-08-29T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000954','0000004-23.2026.8.99.0001','TJEX','2026-08-25T10:00Z','2026-08-28T10:00Z');
insert into app_private.tenant_cases(
  tenant_id, tenant_case_id, case_id, granted_at
) values
  ('10000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000951','2026-08-25T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000952','60000000-0000-7000-8000-000000000952','2026-08-25T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000953','60000000-0000-7000-8000-000000000953','2026-08-25T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000954','60000000-0000-7000-8000-000000000954','2026-08-25T10:00Z');
insert into app_private.outbox_events(
  event_id, tenant_id, event_type, aggregate_type, aggregate_id,
  correlation_id, payload, available_at
)
select
  ('70000000-0000-7000-8000-' || lpad(item::text, 12, '0'))::uuid,
  '10000000-0000-7000-8000-000000000951',
  'monitoring.execution.completed.v1', 'monitoring_execution',
  ('71000000-0000-7000-8000-' || lpad(item::text, 12, '0'))::uuid,
  ('72000000-0000-7000-8000-' || lpad(item::text, 12, '0'))::uuid,
  '{}'::jsonb, '2026-08-31T10:00Z'
from generate_series(951, 955) item;
insert into app_private.alerts(
  tenant_id, alert_id, subject_id, tenant_case_id, case_id,
  source_event_id, alert_type, source_occurred_at
) values
  ('10000000-0000-7000-8000-000000000951','73000000-0000-7000-8000-000000000951','20000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000951','70000000-0000-7000-8000-000000000951','case_discovered','2026-08-31T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','73000000-0000-7000-8000-000000000952','20000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000952','60000000-0000-7000-8000-000000000952','70000000-0000-7000-8000-000000000952','case_discovered','2026-08-30T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','73000000-0000-7000-8000-000000000953','20000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000953','60000000-0000-7000-8000-000000000953','70000000-0000-7000-8000-000000000953','case_discovered','2026-08-29T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','73000000-0000-7000-8000-000000000954','20000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000954','60000000-0000-7000-8000-000000000954','70000000-0000-7000-8000-000000000954','case_discovered','2026-08-28T10:00Z'),
  ('10000000-0000-7000-8000-000000000951','73000000-0000-7000-8000-000000000955','20000000-0000-7000-8000-000000000951','61000000-0000-7000-8000-000000000951','60000000-0000-7000-8000-000000000951','70000000-0000-7000-8000-000000000955','case_discovered','2026-08-27T10:00Z');

select set_config('app.current_user_id', '00000000-0000-7000-8000-000000000951', true);
select set_config('app.current_tenant_id', '10000000-0000-7000-8000-000000000951', true);

select is(
  (select process_count
     from app_private.list_monitored_subject_summaries(null, 10, false)
    where subject_id='20000000-0000-7000-8000-000000000951'),
  4,
  'distinct cases are counted once per explicitly linked profile'
);
select is(
  (select jsonb_array_length(process_summary)
     from app_private.list_monitored_subject_summaries(null, 10, false)
    where subject_id='20000000-0000-7000-8000-000000000951'),
  3,
  'profile summary is bounded to three cases'
);
select is(
  (select process_summary->0->>'cnjNumber'
     from app_private.list_monitored_subject_summaries(null, 10, false)
    where subject_id='20000000-0000-7000-8000-000000000951'),
  '0000001-23.2026.8.99.0001',
  'profile summary is ordered by latest explicit activity'
);
select is(
  (select process_count
     from app_private.list_monitored_subject_summaries(null, 10, false)
    where subject_id='20000000-0000-7000-8000-000000000952'),
  0,
  'an unrelated profile receives no cases from the same tenant'
);

select set_config('app.current_user_id', '00000000-0000-7000-8000-000000000952', true);
select throws_ok(
  $$select * from app_private.list_monitored_subject_summaries(null, 10, false)$$,
  '42501',
  'monitored subject summary membership denied',
  'an outsider cannot list another tenant profile summary'
);

select * from finish();
rollback;
