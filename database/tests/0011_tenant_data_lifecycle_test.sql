begin;
create extension if not exists pgtap;
select no_plan();

select has_table(
  'app_private', 'tenant_data_lifecycle_requests',
  'tenant lifecycle requests are durable'
);
select has_table(
  'app_private', 'tenant_deletion_tombstones',
  'tenant deletion leaves a PII-free technical tombstone'
);
select has_function(
  'app_private', 'request_tenant_data_export',
  array['uuid', 'timestamp with time zone'],
  'runtime can request a tenant export from server-side context'
);
select has_function(
  'app_private', 'request_personal_tenant_deletion',
  array['uuid', 'timestamp with time zone', 'boolean'],
  'runtime can freeze a personal tenant after explicit confirmation'
);
select has_function(
  'app_private', 'claim_tenant_data_lifecycle',
  array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone', 'bytea'],
  'dedicated worker can claim lifecycle work'
);
select has_function(
  'app_private', 'complete_tenant_data_export',
  array['uuid', 'bytea', 'timestamp with time zone', 'uuid', 'text', 'bigint'],
  'dedicated worker can publish export metadata'
);
select has_function(
  'app_private', 'fail_tenant_data_lifecycle',
  array['uuid', 'bytea', 'timestamp with time zone', 'text', 'timestamp with time zone', 'boolean'],
  'dedicated worker can retry or terminally fail work'
);
select has_function(
  'app_private', 'expire_tenant_data_export',
  array['uuid', 'timestamp with time zone'],
  'dedicated worker can mark a deleted export object expired'
);
select has_function(
  'app_private', 'purge_personal_tenant_data',
  array['uuid', 'bytea', 'timestamp with time zone', 'bigint'],
  'dedicated worker can finalize an idempotent tenant purge'
);

select ok(
  exists (select 1 from pg_roles where rolname = 'app_lifecycle_worker')
  and not (
    select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolinherit
      from pg_roles where rolname = 'app_lifecycle_worker'
  ),
  'lifecycle worker has no administration, inheritance or RLS bypass'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in (
      'app_private.tenant_data_lifecycle_requests'::regclass,
      'app_private.tenant_deletion_tombstones'::regclass
    )),
  'lifecycle tables enable and force RLS'
);
select ok(
  not has_table_privilege(
    'app_runtime', 'app_private.tenant_data_lifecycle_requests',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_lifecycle_worker', 'app_private.tenant_data_lifecycle_requests',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'runtime and worker lack direct lifecycle table access'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'app_private.request_tenant_data_export(uuid,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_lifecycle_worker',
    'app_private.request_tenant_data_export(uuid,timestamptz)',
    'EXECUTE'
  ),
  'only runtime receives the tenant export request command'
);
select ok(
  has_function_privilege(
    'app_lifecycle_worker',
    'app_private.claim_tenant_data_lifecycle(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_runtime',
    'app_private.claim_tenant_data_lifecycle(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  ),
  'only lifecycle worker receives the cross-tenant claim command'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'app_private'
       and indexname = 'tenant_data_lifecycle_due_idx'
       and indexdef like '%next_attempt_at, requested_at, request_id%'
  )
  and exists (
    select 1 from pg_indexes
     where schemaname = 'app_private'
       and indexname = 'tenant_data_lifecycle_requester_fk_idx'
  ),
  'queue and composite requester foreign key are indexed'
);

insert into app_private.user_accounts (user_id, provider_subject)
values
  ('00000000-0000-7000-8000-0000000000a1', 'synthetic-lifecycle-alpha'),
  ('00000000-0000-7000-8000-0000000000b2', 'synthetic-lifecycle-beta');

insert into app_private.tenants (tenant_id, tenant_kind, personal_owner_user_id)
values
  ('10000000-0000-7000-8000-0000000000a1', 'personal', '00000000-0000-7000-8000-0000000000a1'),
  ('10000000-0000-7000-8000-0000000000b2', 'personal', '00000000-0000-7000-8000-0000000000b2');

insert into app_private.tenant_members (tenant_id, user_id, membership_role)
values
  ('10000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000a1', 'owner'),
  ('10000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000b2', 'owner');

insert into app_private.monitored_subjects (
  tenant_id, subject_id, subject_type, display_label, protected_reference,
  encrypted_value, key_version
)
values
  (
    '10000000-0000-7000-8000-0000000000a1',
    '20000000-0000-7000-8000-0000000000a1', 'name', 'Pessoa Sintetica A',
    'opaque:lifecycle:alpha', 'legacy:v0:unavailable', 'legacy'
  ),
  (
    '10000000-0000-7000-8000-0000000000b2',
    '20000000-0000-7000-8000-0000000000b2', 'name', 'Pessoa Sintetica B',
    'opaque:lifecycle:beta', 'legacy:v0:unavailable', 'legacy'
  );

set role app_runtime;
select set_config('app.current_user_id', '00000000-0000-7000-8000-0000000000a1', true);
select set_config('app.current_tenant_id', '10000000-0000-7000-8000-0000000000a1', true);

select lives_ok(
  $$select * from app_private.request_tenant_data_export(
    '30000000-0000-7000-8000-0000000000a1',
    '2026-08-31T10:00:00Z'::timestamptz
  )$$,
  'active personal owner can request an export'
);
select lives_ok(
  $$select * from app_private.request_personal_tenant_deletion(
    '30000000-0000-7000-8000-0000000000d1',
    '2026-08-31T10:01:00Z'::timestamptz,
    true
  )$$,
  'confirmed deletion freezes the personal tenant'
);

reset role;
select is(
  (select status from app_private.tenants
    where tenant_id = '10000000-0000-7000-8000-0000000000a1'),
  'deleting',
  'deletion freezes the requested tenant immediately'
);
select ok(
  not (select active from app_private.tenant_members
        where tenant_id = '10000000-0000-7000-8000-0000000000a1')
  and (select active from app_private.tenant_members
        where tenant_id = '10000000-0000-7000-8000-0000000000b2'),
  'freeze revokes alpha without touching beta membership'
);

set role app_lifecycle_worker;
select lives_ok(
  $$select * from app_private.claim_tenant_data_lifecycle(
    '40000000-0000-7000-8000-0000000000d1', 'lifecycle-test-worker',
    '2026-08-31T10:02:00Z'::timestamptz,
    '2026-08-31T10:07:00Z'::timestamptz,
    decode(repeat('ab', 32), 'hex')
  )$$,
  'worker claims the deletion after export cancellation'
);
select lives_ok(
  $$select * from app_private.purge_personal_tenant_data(
    '30000000-0000-7000-8000-0000000000d1',
    decode(repeat('ab', 32), 'hex'),
    '2026-08-31T10:03:00Z'::timestamptz,
    0
  )$$,
  'worker completes the tenant purge with the valid lease token hash'
);

reset role;
select is(
  (select status from app_private.tenants
    where tenant_id = '10000000-0000-7000-8000-0000000000a1'),
  'deleted',
  'purged tenant is finalized as deleted'
);
select ok(
  not exists (
    select 1 from app_private.monitored_subjects
     where tenant_id = '10000000-0000-7000-8000-0000000000a1'
  )
  and exists (
    select 1 from app_private.monitored_subjects
     where tenant_id = '10000000-0000-7000-8000-0000000000b2'
  ),
  'purge removes only alpha private data'
);
select ok(
  (select status = 'deleted' and provider_subject like 'deleted:%'
     from app_private.user_accounts
    where user_id = '00000000-0000-7000-8000-0000000000a1')
  and (select status = 'active' and provider_subject = 'synthetic-lifecycle-beta'
     from app_private.user_accounts
    where user_id = '00000000-0000-7000-8000-0000000000b2'),
  'only the orphaned alpha identity is irreversibly pseudonymized'
);
select ok(
  exists (
    select 1 from app_private.tenant_deletion_tombstones
     where tenant_id = '10000000-0000-7000-8000-0000000000a1'
       and purged_row_count > 0
       and purged_object_count = 0
  ),
  'PII-free tombstone records technical purge counts'
);

select * from finish();
rollback;
