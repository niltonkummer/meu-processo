begin;

create extension if not exists pgtap;
select no_plan();

select has_table(
  'app_private',
  'monitoring_executions',
  'worker executions table exists'
);
select has_table(
  'app_private',
  'monitoring_observation_receipts',
  'minimal observation receipts table exists'
);
select has_table('app_private', 'outbox_events', 'transactional outbox exists');
select has_function(
  'app_private',
  'claim_monitoring_work',
  array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone', 'bytea'],
  'claim function exists'
);
select has_function(
  'app_private',
  'complete_monitoring_work',
  array[
    'uuid', 'bytea', 'timestamp with time zone', 'timestamp with time zone',
    'jsonb', 'bytea', 'uuid'
  ],
  'completion function exists'
);
select has_function(
  'app_private',
  'fail_monitoring_work',
  array[
    'uuid', 'bytea', 'timestamp with time zone', 'text',
    'timestamp with time zone', 'boolean', 'bytea', 'uuid'
  ],
  'failure function exists'
);

select ok(
  exists (select 1 from pg_roles where rolname = 'app_worker'),
  'worker role exists'
);
select ok(
  not (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolinherit
         from pg_roles where rolname = 'app_worker'),
  'worker role has no administration, inheritance or RLS bypass'
);
select ok(
  not has_table_privilege(
    'app_worker', 'app_private.monitoring_executions', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.monitoring_observation_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'app_worker', 'app_private.outbox_events', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'worker has no direct table access'
);
select ok(
  has_function_privilege(
    'app_worker',
    'app_private.claim_monitoring_work(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  )
  and has_function_privilege(
    'app_worker',
    'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'app_worker',
    'app_private.fail_monitoring_work(uuid,bytea,timestamptz,text,timestamptz,boolean,bytea,uuid)',
    'EXECUTE'
  ),
  'worker can execute only the narrow command surface'
);
select ok(
  not has_function_privilege(
    'app_runtime',
    'app_private.claim_monitoring_work(uuid,text,timestamptz,timestamptz,bytea)',
    'EXECUTE'
  ),
  'API runtime cannot claim cross-tenant work'
);
select ok(
  (select bool_and(prosecdef and proconfig is not null)
     from pg_proc
    where oid in (
      'app_private.claim_monitoring_work(uuid,text,timestamptz,timestamptz,bytea)'::regprocedure,
      'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)'::regprocedure,
      'app_private.fail_monitoring_work(uuid,bytea,timestamptz,text,timestamptz,boolean,bytea,uuid)'::regprocedure
    )),
  'worker functions are security definer with fixed configuration'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in (
      'app_private.monitoring_executions'::regclass,
      'app_private.monitoring_observation_receipts'::regclass,
      'app_private.outbox_events'::regclass
    )),
  'worker and outbox tables force RLS'
);
select ok(
  exists (
    select 1 from app_private.sources
     where source_code = 'djen'
       and status = 'disabled'
       and terms_reviewed_at is null
  ),
  'DJEN remains disabled behind the legal and operational gate'
);

insert into app_private.user_accounts (user_id, provider_subject)
values (
  '00000000-0000-7000-8000-000000000021',
  'provider-worker-synthetic'
);
insert into app_private.tenants (
  tenant_id,
  tenant_kind,
  personal_owner_user_id
) values (
  '10000000-0000-7000-8000-000000000021',
  'personal',
  '00000000-0000-7000-8000-000000000021'
);
insert into app_private.tenant_members (
  tenant_id,
  user_id,
  membership_role
) values (
  '10000000-0000-7000-8000-000000000021',
  '00000000-0000-7000-8000-000000000021',
  'owner'
);
insert into app_private.sources (
  source_id,
  source_code,
  source_name,
  authority,
  status,
  terms_version,
  terms_reviewed_at
) values (
  '40000000-0000-7000-8000-000000000021',
  'synthetic',
  'Synthetic Worker Source',
  'Meu Processo',
  'active',
  'local-v1',
  '2026-08-30T00:00:00Z'
);
insert into app_private.monitored_subjects (
  tenant_id,
  subject_id,
  subject_type,
  display_label,
  protected_reference,
  encrypted_value,
  key_version
) values (
  '10000000-0000-7000-8000-000000000021',
  '20000000-0000-7000-8000-000000000021',
  'name',
  'P. S.',
  'hmac-sha256:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'aes-256-gcm:v1:AAAAAAAAAAAAAAAA:AQ:BBBBBBBBBBBBBBBBBBBBBB',
  'v1'
);
insert into app_private.monitoring_targets (
  tenant_id,
  target_id,
  target_type,
  display_label,
  protected_reference
) values (
  '10000000-0000-7000-8000-000000000021',
  '30000000-0000-7000-8000-000000000021',
  'name',
  'P. S.',
  'hmac-sha256:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
);
insert into app_private.subject_targets (tenant_id, subject_id, target_id)
values (
  '10000000-0000-7000-8000-000000000021',
  '20000000-0000-7000-8000-000000000021',
  '30000000-0000-7000-8000-000000000021'
);
insert into app_private.target_source_states (
  tenant_id,
  state_id,
  target_id,
  source_id,
  status,
  next_attempt_at
) values (
  '10000000-0000-7000-8000-000000000021',
  '50000000-0000-7000-8000-000000000021',
  '30000000-0000-7000-8000-000000000021',
  '40000000-0000-7000-8000-000000000021',
  'ready',
  '2026-08-30T12:00:00Z'
);

set role app_worker_local;

select results_eq(
  $$
    select state_id
      from app_private.claim_monitoring_work(
        '60000000-0000-7000-8000-000000000021',
        'worker-local',
        '2026-08-30T12:00:00Z',
        '2026-08-30T12:01:00Z',
        decode(repeat('01', 32), 'hex')
      )
  $$,
  array['50000000-0000-7000-8000-000000000021'::uuid],
  'due state is claimed once'
);
select is(
  (
    select count(*) from app_private.claim_monitoring_work(
      '60000000-0000-7000-8000-000000000022',
      'worker-local',
      '2026-08-30T12:00:00Z',
      '2026-08-30T12:01:00Z',
      decode(repeat('02', 32), 'hex')
    )
  ),
  0::bigint,
  'a running lease is not claimed twice'
);
select is(
  app_private.complete_monitoring_work(
    '60000000-0000-7000-8000-000000000021',
    decode(repeat('ff', 32), 'hex'),
    '2026-08-30T12:00:30Z',
    '2026-08-31T12:00:30Z',
    '[]'::jsonb,
    decode(repeat('03', 32), 'hex'),
    '70000000-0000-7000-8000-000000000021'
  ),
  false,
  'wrong lease cannot complete work'
);
select ok(
  app_private.complete_monitoring_work(
    '60000000-0000-7000-8000-000000000021',
    decode(repeat('01', 32), 'hex'),
    '2026-08-30T12:00:30Z',
    '2026-08-31T12:00:30Z',
    jsonb_build_array(jsonb_build_object(
      'externalId', 'synthetic-publication-1',
      'contentHash', 'sha256:' || repeat('a', 64),
      'parserVersion', 'synthetic-v1',
      'schemaVersion', 1,
      'cnjNumber', '0000001-23.2026.8.99.0021',
      'tribunalCode', 'TJZZ',
      'envelopeId', '81000000-0000-7000-8000-000000000021',
      'observationId', '82000000-0000-7000-8000-000000000021',
      'caseId', '83000000-0000-7000-8000-000000000021',
      'externalReferenceId', '84000000-0000-7000-8000-000000000021',
      'tenantCaseId', '85000000-0000-7000-8000-000000000021',
      'collectedAt', '2026-08-30T12:00:20.000Z',
      'eventType', 'publication',
      'externalEventKey', 'publication-21',
      'occurredAt', '2026-08-30T11:00:00.000Z',
      'title', 'Publicação sintética 21',
      'plainTextExcerpt', 'Trecho sintético 21.',
      'caseEventId', '86000000-0000-7000-8000-000000000021',
      'eventEvidenceId', '87000000-0000-7000-8000-000000000021'
    )),
    decode(repeat('03', 32), 'hex'),
    '70000000-0000-7000-8000-000000000021'
  ),
  'valid lease completes work'
);
select ok(
  app_private.complete_monitoring_work(
    '60000000-0000-7000-8000-000000000021',
    decode(repeat('01', 32), 'hex'),
    '2026-08-30T12:00:30Z',
    '2026-08-31T12:00:30Z',
    jsonb_build_array(jsonb_build_object(
      'externalId', 'synthetic-publication-1',
      'contentHash', 'sha256:' || repeat('a', 64),
      'parserVersion', 'synthetic-v1',
      'schemaVersion', 1,
      'cnjNumber', '0000001-23.2026.8.99.0021',
      'tribunalCode', 'TJZZ',
      'envelopeId', '81000000-0000-7000-8000-000000000022',
      'observationId', '82000000-0000-7000-8000-000000000022',
      'caseId', '83000000-0000-7000-8000-000000000022',
      'externalReferenceId', '84000000-0000-7000-8000-000000000022',
      'tenantCaseId', '85000000-0000-7000-8000-000000000022',
      'collectedAt', '2026-08-30T12:00:20.000Z',
      'eventType', 'publication',
      'externalEventKey', 'publication-21',
      'occurredAt', '2026-08-30T11:00:00.000Z',
      'title', 'Publicação sintética 21',
      'plainTextExcerpt', 'Trecho sintético 21.',
      'caseEventId', '86000000-0000-7000-8000-000000000022',
      'eventEvidenceId', '87000000-0000-7000-8000-000000000022'
    )),
    decode(repeat('03', 32), 'hex'),
    '70000000-0000-7000-8000-000000000022'
  ),
  'duplicate completion is idempotent'
);

reset role;

select is(
  (select status from app_private.target_source_states
    where state_id = '50000000-0000-7000-8000-000000000021'),
  'ready',
  'completion returns state to ready'
);
select is(
  (select count(*) from app_private.monitoring_observation_receipts),
  1::bigint,
  'minimal observation metadata is stored once'
);
select is(
  (select count(*) from app_private.outbox_events),
  1::bigint,
  'completion writes one transactional outbox event'
);
select is(
  (select count(*) from app_private.case_events),
  1::bigint,
  'completion projects one canonical case event'
);
select is(
  (select count(*) from app_private.event_evidence),
  1::bigint,
  'completion links the event to its source envelope'
);

set role app_worker_local;

select is(
  (
    select count(*) from app_private.claim_monitoring_work(
      '60000000-0000-7000-8000-000000000023',
      'worker-local',
      '2026-08-31T12:00:30Z',
      '2026-08-31T12:01:30Z',
      decode(repeat('04', 32), 'hex')
    )
  ),
  1::bigint,
  'next scheduled attempt can be claimed'
);
select ok(
  app_private.fail_monitoring_work(
    '60000000-0000-7000-8000-000000000023',
    decode(repeat('04', 32), 'hex'),
    '2026-08-31T12:01:00Z',
    'SOURCE_TIMEOUT',
    '2026-08-31T13:00:00Z',
    false,
    decode(repeat('05', 32), 'hex'),
    '70000000-0000-7000-8000-000000000023'
  ),
  'retryable failure is accepted'
);
select ok(
  app_private.fail_monitoring_work(
    '60000000-0000-7000-8000-000000000023',
    decode(repeat('04', 32), 'hex'),
    '2026-08-31T12:01:00Z',
    'SOURCE_TIMEOUT',
    '2026-08-31T13:00:00Z',
    false,
    decode(repeat('05', 32), 'hex'),
    '70000000-0000-7000-8000-000000000024'
  ),
  'duplicate failure is idempotent'
);

reset role;

select is(
  (select status from app_private.target_source_states
    where state_id = '50000000-0000-7000-8000-000000000021'),
  'backoff',
  'retryable failure enters backoff'
);
select is(
  (select consecutive_failures from app_private.target_source_states
    where state_id = '50000000-0000-7000-8000-000000000021'),
  1,
  'duplicate failure increments the counter once'
);

set role app_worker_local;

select is(
  (
    select count(*) from app_private.claim_monitoring_work(
      '60000000-0000-7000-8000-000000000024',
      'worker-local',
      '2026-08-31T13:00:00Z',
      '2026-08-31T13:01:00Z',
      decode(repeat('06', 32), 'hex')
    )
  ),
  1::bigint,
  'backoff work is reclaimed when due'
);
select is(
  (
    select count(*) from app_private.claim_monitoring_work(
      '60000000-0000-7000-8000-000000000025',
      'worker-local',
      '2026-08-31T13:01:00Z',
      '2026-08-31T13:02:00Z',
      decode(repeat('07', 32), 'hex')
    )
  ),
  1::bigint,
  'expired lease is reclaimed'
);
select is(
  app_private.complete_monitoring_work(
    '60000000-0000-7000-8000-000000000024',
    decode(repeat('06', 32), 'hex'),
    '2026-08-31T13:01:00Z',
    '2026-09-01T13:01:00Z',
    '[]'::jsonb,
    decode(repeat('08', 32), 'hex'),
    '70000000-0000-7000-8000-000000000025'
  ),
  false,
  'expired owner cannot acknowledge reclaimed work'
);
select ok(
  app_private.fail_monitoring_work(
    '60000000-0000-7000-8000-000000000025',
    decode(repeat('07', 32), 'hex'),
    '2026-08-31T13:01:30Z',
    'SOURCE_REJECTED',
    null,
    true,
    decode(repeat('09', 32), 'hex'),
    '70000000-0000-7000-8000-000000000026'
  ),
  'terminal failure is accepted'
);

reset role;

select is(
  (select status from app_private.monitoring_executions
    where execution_id = '60000000-0000-7000-8000-000000000024'),
  'expired',
  'stale execution is marked expired'
);
select is(
  (select status from app_private.target_source_states
    where state_id = '50000000-0000-7000-8000-000000000021'),
  'disabled',
  'terminal failure disables the source state'
);
select is(
  (select count(*) from app_private.outbox_events),
  3::bigint,
  'idempotent outcomes produce exactly three outbox events'
);
select ok(
  not exists (
    select 1 from app_private.outbox_events
     where payload::text like '%P. S.%'
        or payload::text like '%aes-256-gcm%'
  ),
  'outbox never contains labels or encrypted identifiers'
);

select * from finish();
rollback;
