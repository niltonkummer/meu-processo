begin;
create extension if not exists pgtap;
select no_plan();

select has_table('app_private', 'document_records', 'document metadata catalog exists');
select has_table('app_private', 'document_artifacts', 'private materialization catalog exists');
select has_function(
  'app_private', 'list_tenant_case_documents',
  array['uuid', 'timestamp with time zone', 'uuid', 'integer'],
  'tenant-scoped document query exists'
);
select col_is_pk('app_private', 'document_records', array['tenant_id', 'document_id'], 'document identity is tenant scoped');
select col_is_pk('app_private', 'document_artifacts', array['tenant_id', 'artifact_id'], 'artifact identity is tenant scoped');
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('app_private.document_records'::regclass, 'app_private.document_artifacts'::regclass)),
  'document tables enable and force RLS'
);
select ok(
  not has_table_privilege('app_runtime', 'app_private.document_records', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('app_worker', 'app_private.document_records', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('app_runtime', 'app_private.document_artifacts', 'SELECT,INSERT,UPDATE,DELETE'),
  'runtime roles have no direct document table access'
);
select ok(
  has_function_privilege('app_runtime', 'app_private.list_tenant_case_documents(uuid,timestamptz,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('app_worker', 'app_private.list_tenant_case_documents(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
  'only API runtime can list document metadata'
);
select ok(
  (select prosecdef and proconfig is not null from pg_proc
    where oid='app_private.list_tenant_case_documents(uuid,timestamptz,uuid,integer)'::regprocedure),
  'document query is security definer with fixed configuration'
);
select ok(
  exists (select 1 from pg_indexes where schemaname='app_private'
    and indexname='document_records_case_page_idx'
    and indexdef like '%tenant_id, case_id, source_created_at DESC, document_id DESC%'),
  'document keyset index matches query order'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='app_private.document_records'::regclass
    and contype='u' and pg_get_constraintdef(oid) like '%tenant_id, source_id, external_document_id%'),
  'source document identity is idempotent inside tenant'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='app_private.document_records'::regclass
    and contype='f' and pg_get_constraintdef(oid) like '%tenant_id, case_id, case_event_id%'),
  'document event link preserves the exact tenant and case'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='app_private.document_artifacts'::regclass
    and contype='f' and pg_get_constraintdef(oid) like '%tenant_id, document_id%'),
  'artifact cannot cross tenant document boundaries'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='app_private.document_artifacts'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%documents/tenant/%'),
  'storage object keys are tenant namespaced and not URLs'
);

select * from finish();
rollback;
