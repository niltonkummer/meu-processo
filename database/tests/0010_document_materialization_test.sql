begin;
create extension if not exists pgtap;
select no_plan();

select has_table(
  'app_private', 'document_materialization_jobs',
  'durable document materialization jobs exist'
);
select has_table(
  'app_private', 'document_materialization_executions',
  'immutable materialization executions exist'
);
select has_function(
  'app_private', 'request_tenant_document_materialization',
  array['uuid', 'uuid', 'uuid', 'timestamp with time zone'],
  'tenant runtime can request one exact document'
);
select has_function(
  'app_private', 'claim_document_materialization',
  array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone', 'bytea'],
  'document worker can atomically claim one job'
);
select has_function(
  'app_private', 'complete_document_materialization',
  array[
    'uuid', 'bytea', 'timestamp with time zone', 'uuid', 'text', 'text',
    'text', 'integer', 'timestamp with time zone', 'text', 'bytea', 'uuid'
  ],
  'document worker can atomically publish one artifact outcome'
);
select has_function(
  'app_private', 'fail_document_materialization',
  array[
    'uuid', 'bytea', 'timestamp with time zone', 'text',
    'timestamp with time zone', 'boolean', 'bytea', 'uuid'
  ],
  'document worker can atomically record failure'
);
select ok(
  exists (select 1 from pg_roles where rolname='app_document_worker')
  and not (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolinherit
             from pg_roles where rolname='app_document_worker'),
  'document worker role has no administration, inheritance or RLS bypass'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in (
      'app_private.document_materialization_jobs'::regclass,
      'app_private.document_materialization_executions'::regclass
    )),
  'materialization tables enable and force RLS'
);
select ok(
  not has_table_privilege(
    'app_runtime', 'app_private.document_materialization_jobs',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_document_worker', 'app_private.document_materialization_jobs',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.document_materialization_jobs',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'all application roles lack direct queue table access'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'app_private.request_tenant_document_materialization(uuid,uuid,uuid,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_document_worker',
    'app_private.request_tenant_document_materialization(uuid,uuid,uuid,timestamptz)',
    'EXECUTE'
  ),
  'only API runtime receives the tenant-scoped request command'
);
select ok(
  has_function_privilege(
    'app_document_worker',
    'app_private.claim_document_materialization(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_runtime',
    'app_private.claim_document_materialization(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'app_worker',
    'app_private.claim_document_materialization(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  ),
  'only the dedicated worker receives the cross-tenant claim command'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null)
     from pg_proc
    where oid in (
      'app_private.request_tenant_document_materialization(uuid,uuid,uuid,timestamptz)'::regprocedure,
      'app_private.claim_document_materialization(uuid,text,timestamptz,timestamptz,bytea)'::regprocedure,
      'app_private.complete_document_materialization(uuid,bytea,timestamptz,uuid,text,text,text,integer,timestamptz,text,bytea,uuid)'::regprocedure,
      'app_private.fail_document_materialization(uuid,bytea,timestamptz,text,timestamptz,boolean,bytea,uuid)'::regprocedure
    )),
  'all commands are security definer with fixed configuration'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid='app_private.document_materialization_jobs'::regclass
       and contype='f'
       and pg_get_constraintdef(oid) like '%tenant_id, document_id%'
  ),
  'job cannot cross tenant document boundaries'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname='app_private'
       and indexname='document_materialization_jobs_due_idx'
       and indexdef like '%next_attempt_at, materialization_id%'
  ),
  'partial queue index matches due claim order'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname='app_private'
       and indexname='document_materialization_executions_one_running_idx'
  ),
  'one active execution is enforced per tenant job'
);

select * from finish();
rollback;

