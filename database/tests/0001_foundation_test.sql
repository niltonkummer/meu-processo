begin;

create extension if not exists pgtap;
select no_plan();

select has_schema('app_private', 'private application schema exists');
select has_schema('app_public', 'public contract schema exists');

select has_table('app_private', 'user_accounts', 'user accounts table exists');
select has_table('app_private', 'tenants', 'tenants table exists');
select has_table('app_private', 'tenant_members', 'tenant members table exists');
select has_table('app_private', 'monitored_subjects', 'subjects table exists');
select has_table('app_private', 'monitoring_targets', 'targets table exists');
select has_table('app_private', 'subject_targets', 'subject targets table exists');
select has_table('app_private', 'sources', 'source catalog exists');
select has_table(
  'app_private',
  'target_source_states',
  'tenant-scoped target source state exists'
);

select col_type_is(
  'app_private',
  'tenant_members',
  'created_at',
  'timestamp with time zone',
  'membership timestamps preserve timezone'
);
select col_not_null(
  'app_private',
  'monitored_subjects',
  'tenant_id',
  'subjects always belong to a tenant'
);
select col_not_null(
  'app_private',
  'monitored_subjects',
  'encrypted_value',
  'subject ciphertext is mandatory'
);
select col_not_null(
  'app_private',
  'monitored_subjects',
  'key_version',
  'subject key version is mandatory'
);
select has_pk('app_private', 'tenant_members', 'memberships have a primary key');
select has_fk('app_private', 'tenant_members', 'memberships have foreign keys');
select has_fk('app_private', 'subject_targets', 'subject targets have foreign keys');

select has_index(
  'app_private',
  'tenant_members',
  'tenant_members_user_id_idx',
  'membership user foreign key is indexed'
);
select has_index(
  'app_private',
  'monitoring_targets',
  'monitoring_targets_due_idx',
  'due active targets have a directed index'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class
    where oid = 'app_private.monitored_subjects'::regclass),
  'subjects enable and force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class
    where oid = 'app_private.target_source_states'::regclass),
  'target source states enable and force RLS'
);
select ok(
  has_table_privilege('app_runtime', 'app_private.sources', 'SELECT')
  and not has_table_privilege('app_runtime', 'app_private.sources', 'INSERT')
  and not has_table_privilege('app_runtime', 'app_private.sources', 'UPDATE')
  and not has_table_privilege('app_runtime', 'app_private.sources', 'DELETE'),
  'runtime can read but cannot mutate the source catalog'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class
    where oid = 'app_private.monitoring_targets'::regclass),
  'targets enable and force RLS'
);
select ok(
  not has_schema_privilege('app_runtime', 'app_private', 'CREATE'),
  'runtime cannot create objects in the private schema'
);
select ok(
  not (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls
         from pg_roles
        where rolname = 'app_runtime'),
  'runtime role has no administrative or RLS bypass privilege'
);

insert into app_private.user_accounts (user_id, provider_subject)
values
  ('00000000-0000-7000-8000-000000000001', 'provider-user-alpha'),
  ('00000000-0000-7000-8000-000000000002', 'provider-user-beta');

insert into app_private.tenants (
  tenant_id,
  tenant_kind,
  personal_owner_user_id
)
values
  (
    '10000000-0000-7000-8000-000000000001',
    'personal',
    '00000000-0000-7000-8000-000000000001'
  ),
  (
    '10000000-0000-7000-8000-000000000002',
    'personal',
    '00000000-0000-7000-8000-000000000002'
  );

insert into app_private.tenant_members (
  tenant_id,
  user_id,
  membership_role
)
values
  (
    '10000000-0000-7000-8000-000000000001',
    '00000000-0000-7000-8000-000000000001',
    'owner'
  ),
  (
    '10000000-0000-7000-8000-000000000002',
    '00000000-0000-7000-8000-000000000002',
    'owner'
  );

insert into app_private.monitored_subjects (
  tenant_id,
  subject_id,
  subject_type,
  display_label,
  protected_reference,
  encrypted_value,
  key_version
)
values
  (
    '10000000-0000-7000-8000-000000000001',
    '20000000-0000-7000-8000-000000000001',
    'name',
    'Synthetic Subject Alpha',
    'opaque:subject:alpha',
    'legacy:v0:unavailable',
    'legacy'
  ),
  (
    '10000000-0000-7000-8000-000000000002',
    '20000000-0000-7000-8000-000000000002',
    'name',
    'Synthetic Subject Beta',
    'opaque:subject:beta',
    'legacy:v0:unavailable',
    'legacy'
  );

insert into app_private.monitoring_targets (
  tenant_id,
  target_id,
  target_type,
  display_label,
  protected_reference
)
values
  (
    '10000000-0000-7000-8000-000000000001',
    '30000000-0000-7000-8000-000000000001',
    'name',
    'Synthetic Target Alpha',
    'opaque:target:alpha'
  ),
  (
    '10000000-0000-7000-8000-000000000002',
    '30000000-0000-7000-8000-000000000002',
    'name',
    'Synthetic Target Beta',
    'opaque:target:beta'
  );

insert into app_private.target_source_states (
  tenant_id,
  state_id,
  target_id,
  source_id
)
values
  (
    '10000000-0000-7000-8000-000000000001',
    '50000000-0000-7000-8000-000000000001',
    '30000000-0000-7000-8000-000000000001',
    '40000000-0000-7000-8000-000000000001'
  ),
  (
    '10000000-0000-7000-8000-000000000002',
    '50000000-0000-7000-8000-000000000002',
    '30000000-0000-7000-8000-000000000002',
    '40000000-0000-7000-8000-000000000001'
  );

set role app_runtime;
select set_config(
  'app.current_user_id',
  '00000000-0000-7000-8000-000000000001',
  true
);
select set_config(
  'app.current_tenant_id',
  '10000000-0000-7000-8000-000000000001',
  true
);

select results_eq(
  $$
    select subject_id
      from app_private.monitored_subjects
     order by subject_id
  $$,
  array['20000000-0000-7000-8000-000000000001'::uuid],
  'runtime reads only the current tenant subjects'
);

select results_eq(
  $$
    select state_id
      from app_private.target_source_states
     order by state_id
  $$,
  array['50000000-0000-7000-8000-000000000001'::uuid],
  'runtime reads only the current tenant source state'
);

select results_eq(
  $$
    select target_id
      from app_private.monitoring_targets
     order by target_id
  $$,
  array['30000000-0000-7000-8000-000000000001'::uuid],
  'runtime reads only the current tenant targets'
);

select throws_ok(
  $$
    insert into app_private.monitored_subjects (
      tenant_id,
      subject_id,
      subject_type,
      display_label,
      protected_reference,
      encrypted_value,
      key_version
    ) values (
      '10000000-0000-7000-8000-000000000002',
      '20000000-0000-7000-8000-000000000003',
      'name',
      'Cross Tenant Attempt',
      'opaque:cross:tenant',
      'legacy:v0:unavailable',
      'legacy'
    )
  $$,
  '42501',
  null,
  'RLS rejects a cross-tenant insert'
);

select throws_ok(
  $$
    insert into app_private.monitored_subjects (
      tenant_id,
      subject_id,
      subject_type,
      display_label,
      protected_reference,
      encrypted_value,
      key_version
    ) values (
      '10000000-0000-7000-8000-000000000001',
      '20000000-0000-7000-8000-000000000004',
      'cpf',
      '***.***.***-09',
      'not-a-blind-index',
      'not-an-authenticated-envelope',
      'v1'
    )
  $$,
  '23514',
  null,
  'database rejects malformed protected identifiers'
);

select throws_ok(
  $$
    insert into app_private.target_source_states (
      tenant_id,
      state_id,
      target_id,
      source_id
    ) values (
      '10000000-0000-7000-8000-000000000001',
      '50000000-0000-7000-8000-000000000003',
      '30000000-0000-7000-8000-000000000002',
      '40000000-0000-7000-8000-000000000001'
    )
  $$,
  '23503',
  null,
  'composite foreign keys reject cross-tenant source state'
);

select throws_ok(
  $$
    insert into app_private.subject_targets (
      tenant_id,
      subject_id,
      target_id
    ) values (
      '10000000-0000-7000-8000-000000000001',
      '20000000-0000-7000-8000-000000000001',
      '30000000-0000-7000-8000-000000000002'
    )
  $$,
  '23503',
  null,
  'composite foreign keys reject a cross-tenant relation'
);

select throws_ok(
  'create table app_private.runtime_escape (escape_id integer)',
  '42501',
  null,
  'runtime cannot execute DDL in the private schema'
);

select set_config('app.current_tenant_id', '', true);
select is(
  (select count(*) from app_private.monitored_subjects),
  0::bigint,
  'missing tenant context fails closed for reads'
);

reset role;

select * from finish();
rollback;
