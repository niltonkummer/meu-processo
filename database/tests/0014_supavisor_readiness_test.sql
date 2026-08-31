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

select * from finish();
rollback;
