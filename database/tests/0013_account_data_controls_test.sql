begin;
create extension if not exists pgtap;
select plan(9);

select has_function(
  'app_private', 'get_tenant_data_lifecycle_request', array['uuid'],
  'status projection exists'
);
select function_privs_are(
  'app_private', 'get_tenant_data_lifecycle_request', array['uuid'],
  'app_runtime', array['EXECUTE'], 'runtime can query lifecycle status'
);
select function_privs_are(
  'app_private', 'get_tenant_data_lifecycle_request', array['uuid'],
  'app_worker', array[]::text[], 'monitoring worker cannot query exports'
);
select function_privs_are(
  'app_private', 'get_tenant_data_lifecycle_request', array['uuid'],
  'app_lifecycle_worker', array[]::text[], 'lifecycle worker cannot impersonate runtime'
);
select ok(
  (select array_to_string(proconfig, ',')='search_path=""'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname='get_tenant_data_lifecycle_request'),
  'projection fixes an empty search path'
);
select has_trigger(
  'app_private', 'document_download_windows',
  'document_download_windows_monotonic_timestamp',
  'concurrent quota updates preserve timestamp monotonicity'
);
select function_privs_are(
  'app_private', 'enforce_monotonic_download_window_timestamp', array[]::text[],
  'app_runtime', array[]::text[], 'runtime cannot invoke the timestamp trigger directly'
);
select is(
  (select provolatile::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname='get_tenant_data_lifecycle_request'),
  's', 'projection is stable'
);
select ok(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname='get_tenant_data_lifecycle_request'),
  'projection is security definer behind tenant checks'
);

select * from finish();
rollback;
