begin;

create extension if not exists pgtap;
select no_plan();

select has_table('app_private', 'source_envelopes', 'source envelopes exist');
select has_table(
  'app_private', 'canonical_observations', 'canonical observations exist'
);
select has_table('app_private', 'case_records', 'case projections exist');
select has_table(
  'app_private', 'case_external_references', 'external case references exist'
);
select has_table('app_private', 'tenant_cases', 'tenant case grants exist');
select has_column(
  'app_private', 'sources', 'source_class',
  'source classification is explicit'
);
select has_function(
  'app_private',
  'list_tenant_case_summaries',
  array['uuid', 'integer'],
  'authorized case portfolio projection exists'
);

select col_is_pk(
  'app_private', 'source_envelopes', array['tenant_id', 'envelope_id'],
  'envelope primary key is tenant scoped'
);
select col_is_pk(
  'app_private', 'canonical_observations',
  array['tenant_id', 'observation_id'],
  'observation primary key is tenant scoped'
);
select col_is_pk(
  'app_private', 'case_records', array['tenant_id', 'case_id'],
  'case primary key is tenant scoped'
);
select col_is_pk(
  'app_private', 'tenant_cases', array['tenant_id', 'tenant_case_id'],
  'tenant case primary key is tenant scoped'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in (
      'app_private.source_envelopes'::regclass,
      'app_private.canonical_observations'::regclass,
      'app_private.case_records'::regclass,
      'app_private.case_external_references'::regclass,
      'app_private.tenant_cases'::regclass
    )),
  'all evidence tables enable and force RLS'
);

select ok(
  not has_table_privilege(
    'app_worker', 'app_private.source_envelopes',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.canonical_observations',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.case_records',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.case_external_references',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.tenant_cases',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'worker has no direct access to evidence'
);

select ok(
  not has_function_privilege(
    'app_worker',
    'app_private.complete_monitoring_work_receipts(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)',
    'EXECUTE'
  ),
  'worker cannot bypass canonical evidence through the legacy receipt helper'
);
select ok(
  has_function_privilege(
    'app_worker',
    'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)',
    'EXECUTE'
  ),
  'worker can use only the evidence-aware completion command'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'app_private.list_tenant_case_summaries(uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_worker',
    'app_private.list_tenant_case_summaries(uuid,integer)',
    'EXECUTE'
  ),
  'only API runtime can execute the portfolio projection'
);
select ok(
  not has_table_privilege(
    'app_runtime', 'app_private.case_records',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_runtime', 'app_private.tenant_cases',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'API runtime has no direct evidence table access'
);
select ok(
  (select prosecdef and proconfig is not null
     from pg_proc
    where oid =
      'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)'::regprocedure),
  'evidence completion is security definer with fixed configuration'
);
select ok(
  (select prosecdef and proconfig is not null
     from pg_proc
    where oid =
      'app_private.list_tenant_case_summaries(uuid,integer)'::regprocedure),
  'portfolio projection is security definer with fixed configuration'
);
select ok(
  (select source_class = 'official'
     from app_private.sources where source_code = 'djen')
  and
  (select source_class = 'synthetic'
     from app_private.sources where source_code = 'synthetic-worker'),
  'official and synthetic sources are not conflated'
);

select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'app_private.source_envelopes'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) like
         '%tenant_id, source_id, external_id, content_hash%'
  ),
  'envelopes deduplicate inside a tenant and source'
);
select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'app_private.case_records'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) like '%tenant_id, cnj_normalized%'
  ),
  'case identity is unique only inside a tenant in this phase'
);
select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'app_private.tenant_cases'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) like
         '%FOREIGN KEY (tenant_id, case_id)%'
  ),
  'tenant case cannot reference a cross-tenant case'
);

select * from finish();
rollback;
