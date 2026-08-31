begin;
create extension if not exists pgtap;
select no_plan();

select has_table('app_private', 'document_download_windows', 'durable download quota exists');
select has_table('app_private', 'document_download_authorizations', 'immutable download authorization exists');
select has_table('app_private', 'document_download_outcomes', 'download outcome audit exists');
select has_function(
  'app_private', 'authorize_tenant_document_download',
  array['uuid', 'uuid', 'uuid', 'uuid', 'integer'],
  'atomic document authorization function exists'
);
select has_function(
  'app_private', 'record_document_download_outcome',
  array['uuid', 'text'],
  'outcome audit function exists'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class where oid in (
       'app_private.document_download_windows'::regclass,
       'app_private.document_download_authorizations'::regclass,
       'app_private.document_download_outcomes'::regclass
     )),
  'all download control tables enable and force RLS'
);
select ok(
  not has_table_privilege('app_runtime', 'app_private.document_download_windows', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('app_runtime', 'app_private.document_download_authorizations', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('app_runtime', 'app_private.document_download_outcomes', 'SELECT,INSERT,UPDATE,DELETE'),
  'runtime has no direct access to quota or audit tables'
);
select ok(
  has_function_privilege('app_runtime', 'app_private.authorize_tenant_document_download(uuid,uuid,uuid,uuid,integer)', 'EXECUTE')
  and has_function_privilege('app_runtime', 'app_private.record_document_download_outcome(uuid,text)', 'EXECUTE')
  and not has_function_privilege('app_worker', 'app_private.authorize_tenant_document_download(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  'only API runtime can authorize and record a delivery'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null)
     from pg_proc where oid in (
       'app_private.authorize_tenant_document_download(uuid,uuid,uuid,uuid,integer)'::regprocedure,
       'app_private.record_document_download_outcome(uuid,text)'::regprocedure
     )),
  'delivery functions are security definer with fixed configuration'
);
select ok(
  exists (select 1 from pg_constraint
    where conrelid='app_private.document_download_authorizations'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) like '%tenant_id, case_id, document_id%'),
  'authorization binds document to its exact tenant and case'
);
select ok(
  exists (select 1 from pg_constraint
    where conrelid='app_private.document_download_authorizations'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) like '%tenant_id, document_id, artifact_id%'),
  'authorization binds artifact to its exact document'
);
select ok(
  exists (select 1 from pg_indexes
    where schemaname='app_private'
      and indexname='document_download_authorizations_user_time_idx'),
  'authorization audit has a bounded user/time access path'
);

select * from finish();
rollback;
