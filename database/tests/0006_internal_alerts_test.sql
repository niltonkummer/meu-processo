begin;

create extension if not exists pgtap;
select no_plan();

select has_table('app_private', 'alerts', 'internal alerts exist');
select has_function(
  'app_private', 'project_internal_alerts',
  array['uuid', 'uuid', 'text', 'uuid', 'jsonb', 'timestamp with time zone'],
  'idempotent internal alert projector exists'
);
select has_function(
  'app_private', 'list_tenant_alerts_v2',
  array['text', 'timestamp with time zone', 'uuid', 'integer'],
  'tenant alert list exists'
);
select has_function(
  'app_private', 'mark_tenant_alert_read_v2',
  array['uuid', 'timestamp with time zone'],
  'tenant alert read command exists'
);
select col_is_pk(
  'app_private', 'alerts', array['tenant_id', 'alert_id'],
  'alert identity is tenant scoped'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'app_private.alerts'::regclass),
  'alerts enable and force RLS'
);
select ok(
  not has_table_privilege(
    'app_runtime', 'app_private.alerts', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_dispatcher', 'app_private.alerts', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.alerts', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'runtime roles have no direct alert table access'
);
select ok(
  has_function_privilege(
    'app_dispatcher',
    'app_private.project_internal_alerts(uuid,uuid,text,uuid,jsonb,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_runtime',
    'app_private.project_internal_alerts(uuid,uuid,text,uuid,jsonb,timestamptz)',
    'EXECUTE'
  ),
  'only dispatcher can project internal alerts'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'app_private.list_tenant_alerts_v2(text,timestamptz,uuid,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'app_runtime',
    'app_private.mark_tenant_alert_read_v2(uuid,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_dispatcher',
    'app_private.list_tenant_alerts_v2(text,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'API has only the narrow alert read surface'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null)
     from pg_proc
    where oid in (
      'app_private.project_internal_alerts(uuid,uuid,text,uuid,jsonb,timestamptz)'::regprocedure,
      'app_private.list_tenant_alerts_v2(text,timestamptz,uuid,integer)'::regprocedure,
      'app_private.mark_tenant_alert_read_v2(uuid,timestamptz)'::regprocedure
    )),
  'alert functions are security definer with fixed configuration'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'app_private'
       and indexname = 'alerts_tenant_created_idx'
       and indexdef like '%tenant_id, created_at DESC, alert_id DESC%'
  )
  and exists (
    select 1 from pg_indexes
     where schemaname = 'app_private'
       and indexname = 'alerts_tenant_unread_idx'
       and indexdef like '%WHERE (status = ''unread''::text)%'
  ),
  'keyset and partial unread indexes exist'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'app_private.alerts'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) like
         '%FOREIGN KEY (tenant_id, tenant_case_id, case_id)%'
  ),
  'alert cannot mix a tenant case with another case'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'app_private.alerts'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) like
         '%tenant_id, source_event_id, subject_id, tenant_case_id, case_event_id, alert_type%'
  ),
  'alert deduplication includes the exact case event'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'app_private.alerts'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) like
         '%FOREIGN KEY (tenant_id, case_event_id)%'
  ),
  'alert case event cannot cross tenant boundaries'
);

select * from finish();
rollback;
