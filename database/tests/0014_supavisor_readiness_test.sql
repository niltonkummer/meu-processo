begin;

create extension if not exists pgtap;
select no_plan();

select is(
  (
    select count(*)
      from pg_class as relation
      join pg_namespace as namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'app_private'
       and relation.relkind in ('r', 'p')
       and exists (
         select 1
           from pg_attribute as attribute
          where attribute.attrelid = relation.oid
            and attribute.attname = 'tenant_id'
            and attribute.attnum > 0
            and not attribute.attisdropped
       )
       and not (relation.relrowsecurity and relation.relforcerowsecurity)
  ),
  0::bigint,
  'every tenant-scoped table enables and forces RLS'
);

select is(
  (
    select count(*)
      from pg_roles
     where rolname in (
       'app_runtime',
       'app_worker',
       'app_dispatcher',
       'app_document_worker',
       'app_lifecycle_worker'
     )
  ),
  5::bigint,
  'all restricted workload roles exist'
);

select ok(
  not exists (
    select 1
      from pg_roles
     where rolname in (
       'app_runtime',
       'app_worker',
       'app_dispatcher',
       'app_document_worker',
       'app_lifecycle_worker'
     )
       and (
         rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or
         rolinherit or rolcanlogin
       )
  ),
  'workload group roles cannot login, inherit, administer or bypass RLS'
);

select ok(
  not has_schema_privilege('public', 'app_private', 'USAGE')
  and not has_schema_privilege('public', 'app_private', 'CREATE'),
  'the private schema is unavailable to public'
);

select ok(
  (
    select owner.rolname = 'app_migrator'
      from pg_namespace as namespace
      join pg_roles as owner on owner.oid = namespace.nspowner
     where namespace.nspname = 'app_private'
  ),
  'the migration role owns the private schema without ownership leaking to runtime roles'
);

select ok(
  has_database_privilege('app_migrator', current_database(), 'CREATE')
  and not has_database_privilege('app_runtime', current_database(), 'CREATE'),
  'only the migration role can create schemas in the application database'
);

select ok(
  has_schema_privilege('app_migrator', 'extensions', 'USAGE')
  and has_function_privilege(
    'app_migrator',
    'extensions.digest(bytea,text)',
    'EXECUTE'
  )
  and not exists (
    select 1
      from pg_proc as routine
      join pg_namespace as namespace on namespace.oid = routine.pronamespace
     where namespace.nspname = 'app_private'
       and routine.proname in (
         'project_internal_alerts',
         'project_internal_alerts_without_timeline'
       )
       and routine.prosrc like '%public.digest%'
  ),
  'security-definer alert projections resolve pgcrypto in its managed schema'
);

select ok(
  has_schema_privilege('app_runtime', 'app_private', 'USAGE')
  and has_schema_privilege('app_runtime', 'app_public', 'USAGE')
  and has_table_privilege(
    'app_runtime',
    'app_private.user_accounts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and has_table_privilege(
    'app_runtime',
    'app_private.target_source_states',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'runtime foundation grants survive a non-superuser migration session'
);

select ok(
  exists (
    select 1
      from pg_auth_members as membership
      join pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_roles as member_role
        on member_role.oid = membership.member
     where granted_role.rolname = 'app_migrator'
       and member_role.rolname = session_user
  ),
  'the migration session is explicitly authorized to assume its owner role'
);

select ok(
  exists (
    select 1
      from pg_auth_members as membership
      join pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_roles as member_role
        on member_role.oid = membership.member
     where granted_role.rolname = 'app_migrator'
       and member_role.rolname = current_user
       and membership.inherit_option
       and membership.set_option
  )
  and has_table_privilege(
    current_user,
    'app_private.user_accounts',
    'INSERT'
  ),
  'the managed administrator inherits migration-owner access for maintenance'
);

select * from finish();
rollback;
