begin;
create extension if not exists pgtap;
select no_plan();

select has_table('app_private', 'case_events', 'canonical case events exist');
select has_table('app_private', 'event_evidence', 'event evidence links exist');
select has_function('app_private', 'tenant_case_is_visible', array['uuid'], 'case visibility function exists');
select has_function(
  'app_private', 'list_tenant_case_events',
  array['uuid', 'timestamp with time zone', 'uuid', 'integer'],
  'case timeline query exists'
);
select col_is_pk('app_private', 'case_events', array['tenant_id', 'case_event_id'], 'event identity is tenant scoped');
select col_is_pk('app_private', 'event_evidence', array['tenant_id', 'event_evidence_id'], 'evidence identity is tenant scoped');
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('app_private.case_events'::regclass, 'app_private.event_evidence'::regclass)),
  'timeline tables enable and force RLS'
);
select ok(
  not has_table_privilege('app_runtime', 'app_private.case_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('app_worker', 'app_private.case_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('app_runtime', 'app_private.event_evidence', 'SELECT,INSERT,UPDATE,DELETE'),
  'runtime roles have no direct timeline table access'
);
select ok(
  has_function_privilege('app_runtime', 'app_private.list_tenant_case_events(uuid,timestamptz,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('app_worker', 'app_private.list_tenant_case_events(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
  'only API runtime can list the timeline'
);
select ok(
  has_function_privilege('app_worker', 'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)', 'EXECUTE')
  and not has_function_privilege('app_worker', 'app_private.complete_monitoring_work_case_evidence(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)', 'EXECUTE'),
  'worker cannot bypass canonical timeline persistence'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null) from pg_proc where oid in (
    'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)'::regprocedure,
    'app_private.tenant_case_is_visible(uuid)'::regprocedure,
    'app_private.list_tenant_case_events(uuid,timestamptz,uuid,integer)'::regprocedure
  )),
  'timeline functions are security definer with fixed configuration'
);
select ok(
  exists (select 1 from pg_indexes where schemaname='app_private' and indexname='case_events_timeline_idx'
    and indexdef like '%tenant_id, case_id, occurred_at DESC, case_event_id DESC%'),
  'timeline keyset index matches query order'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='app_private.case_events'::regclass
    and contype='u' and pg_get_constraintdef(oid) like '%tenant_id, source_id, external_event_key%'),
  'source event identity is unique inside tenant'
);
select ok(
  exists (select 1 from pg_constraint where conrelid='app_private.event_evidence'::regclass
    and contype='f' and pg_get_constraintdef(oid) like '%tenant_id, case_event_id%'),
  'event evidence cannot cross tenant boundaries'
);

select * from finish();
rollback;

