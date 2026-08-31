begin;
create extension if not exists pgtap;
select no_plan();

select has_function(
  'app_private', 'snapshot_claimed_tenant_export',
  array['uuid', 'bytea', 'timestamp with time zone'],
  'worker can snapshot only its claimed export'
);
select has_function(
  'app_private', 'list_claimed_tenant_object_ids',
  array['uuid', 'bytea', 'timestamp with time zone'],
  'deletion worker can inventory opaque tenant objects'
);
select has_function(
  'app_private', 'list_due_tenant_export_expirations',
  array['timestamp with time zone', 'integer'],
  'worker can list bounded due export expirations'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null)
     from pg_proc
    where oid in (
      'app_private.snapshot_claimed_tenant_export(uuid,bytea,timestamptz)'::regprocedure,
      'app_private.list_claimed_tenant_object_ids(uuid,bytea,timestamptz)'::regprocedure,
      'app_private.list_due_tenant_export_expirations(timestamptz,integer)'::regprocedure
    )),
  'all lifecycle worker reads are security definer with fixed configuration'
);
select ok(
  has_function_privilege(
    'app_lifecycle_worker',
    'app_private.snapshot_claimed_tenant_export(uuid,bytea,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_runtime',
    'app_private.snapshot_claimed_tenant_export(uuid,bytea,timestamptz)',
    'EXECUTE'
  ),
  'only lifecycle worker receives the snapshot command'
);

insert into app_private.user_accounts (user_id, provider_subject)
values ('00000000-0000-7000-8000-0000000000c3', 'worker-export-synthetic');
insert into app_private.tenants (tenant_id, tenant_kind, personal_owner_user_id)
values (
  '10000000-0000-7000-8000-0000000000c3', 'personal',
  '00000000-0000-7000-8000-0000000000c3'
);
insert into app_private.tenant_members (tenant_id, user_id, membership_role)
values (
  '10000000-0000-7000-8000-0000000000c3',
  '00000000-0000-7000-8000-0000000000c3', 'owner'
);
insert into app_private.monitored_subjects (
  tenant_id, subject_id, subject_type, display_label, protected_reference,
  encrypted_value, key_version
) values (
  '10000000-0000-7000-8000-0000000000c3',
  '20000000-0000-7000-8000-0000000000c3', 'name', 'P. S. C.',
  'opaque:worker:subject', 'legacy:v0:unavailable', 'legacy'
);

set role app_runtime;
select set_config('app.current_user_id', '00000000-0000-7000-8000-0000000000c3', true);
select set_config('app.current_tenant_id', '10000000-0000-7000-8000-0000000000c3', true);
select * from app_private.request_tenant_data_export(
  '30000000-0000-7000-8000-0000000000c3',
  '2026-08-31T13:00:00Z'::timestamptz
);

reset role;
set role app_lifecycle_worker;
select * from app_private.claim_tenant_data_lifecycle(
  '40000000-0000-7000-8000-0000000000c3', 'snapshot-worker',
  '2026-08-31T13:00:01Z'::timestamptz,
  '2026-08-31T13:05:01Z'::timestamptz,
  decode(repeat('cd', 32), 'hex')
);

select is(
  app_private.snapshot_claimed_tenant_export(
    '30000000-0000-7000-8000-0000000000c3',
    decode(repeat('cd', 32), 'hex'),
    '2026-08-31T13:00:02Z'::timestamptz
  )->>'schemaVersion',
  '1',
  'snapshot is explicitly schema versioned'
);
select is(
  app_private.snapshot_claimed_tenant_export(
    '30000000-0000-7000-8000-0000000000c3',
    decode(repeat('cd', 32), 'hex'),
    '2026-08-31T13:00:02Z'::timestamptz
  )#>>'{tenant,tenantId}',
  '10000000-0000-7000-8000-0000000000c3',
  'snapshot is bound to the claimed tenant'
);
select is(
  jsonb_array_length(
    app_private.snapshot_claimed_tenant_export(
      '30000000-0000-7000-8000-0000000000c3',
      decode(repeat('cd', 32), 'hex'),
      '2026-08-31T13:00:02Z'::timestamptz
    )->'protectedSubjects'
  ),
  1,
  'snapshot includes the protected subject only for in-memory reveal'
);
select ok(
  not (
    app_private.snapshot_claimed_tenant_export(
      '30000000-0000-7000-8000-0000000000c3',
      decode(repeat('cd', 32), 'hex'),
      '2026-08-31T13:00:02Z'::timestamptz
    )::text like '%worker-export-synthetic%'
  )
  and not (
    app_private.snapshot_claimed_tenant_export(
      '30000000-0000-7000-8000-0000000000c3',
      decode(repeat('cd', 32), 'hex'),
      '2026-08-31T13:00:02Z'::timestamptz
    )::text like '%opaque:worker:subject%'
  ),
  'snapshot excludes provider subject and blind index'
);
select is(
  app_private.snapshot_claimed_tenant_export(
    '30000000-0000-7000-8000-0000000000c3',
    decode(repeat('ef', 32), 'hex'),
    '2026-08-31T13:00:02Z'::timestamptz
  ),
  null::jsonb,
  'wrong lease hash receives no snapshot'
);
select is_empty(
  $$select * from app_private.list_claimed_tenant_object_ids(
    '30000000-0000-7000-8000-0000000000c3',
    decode(repeat('cd', 32), 'hex'),
    '2026-08-31T13:00:02Z'::timestamptz
  )$$,
  'an export claim cannot inventory deletion objects'
);

reset role;
select * from finish();
rollback;
