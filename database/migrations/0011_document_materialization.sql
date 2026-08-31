begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname='app_document_worker') then
    create role app_document_worker
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end
$$;

set role app_migrator;

grant usage on schema app_private to app_document_worker;

create table app_private.document_materialization_jobs (
  tenant_id uuid not null,
  materialization_id uuid not null,
  document_id uuid not null,
  requested_by_user_id uuid not null,
  status text not null check (
    status in ('pending', 'running', 'retry', 'completed', 'dead')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz,
  last_failure_code text check (
    last_failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  requested_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, materialization_id),
  unique (tenant_id, document_id),
  foreign key (tenant_id, document_id)
    references app_private.document_records(tenant_id, document_id),
  foreign key (tenant_id, requested_by_user_id)
    references app_private.tenant_members(tenant_id, user_id),
  check (
    (status in ('pending', 'retry') and next_attempt_at is not null
      and completed_at is null)
    or (status = 'running' and next_attempt_at is null and completed_at is null)
    or (status = 'completed' and next_attempt_at is null
      and completed_at is not null and last_failure_code is null)
    or (status = 'dead' and next_attempt_at is null
      and completed_at is null and last_failure_code is not null)
  ),
  check (
    (status = 'retry' and last_failure_code is not null)
    or status <> 'retry'
  ),
  check (updated_at >= created_at),
  check (completed_at is null or completed_at >= requested_at)
);

create index document_materialization_jobs_due_idx
  on app_private.document_materialization_jobs(
    next_attempt_at, materialization_id
  ) where status in ('pending', 'retry');
create index document_materialization_jobs_requester_fk_idx
  on app_private.document_materialization_jobs(tenant_id, requested_by_user_id);

create table app_private.document_materialization_executions (
  execution_id uuid primary key,
  tenant_id uuid not null,
  materialization_id uuid not null,
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  lease_token_hash bytea not null check (octet_length(lease_token_hash) = 32),
  leased_until timestamptz not null,
  attempt_number integer not null check (attempt_number between 1 and 20),
  status text not null check (
    status in ('running', 'completed', 'failed', 'expired')
  ),
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  artifact_id uuid,
  outcome_fingerprint bytea check (octet_length(outcome_fingerprint) = 32),
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (tenant_id, execution_id),
  foreign key (tenant_id, materialization_id)
    references app_private.document_materialization_jobs(
      tenant_id, materialization_id
    ),
  foreign key (tenant_id, artifact_id)
    references app_private.document_artifacts(tenant_id, artifact_id),
  check (leased_until > started_at),
  check (
    (status = 'running' and finished_at is null and failure_code is null
      and artifact_id is null and outcome_fingerprint is null)
    or (status = 'expired' and finished_at is not null and failure_code is null
      and artifact_id is null and outcome_fingerprint is null)
    or (status = 'completed' and finished_at is not null
      and failure_code is null and artifact_id is not null
      and outcome_fingerprint is not null)
    or (status = 'failed' and finished_at is not null
      and failure_code is not null and artifact_id is null
      and outcome_fingerprint is not null)
  )
);

create unique index document_materialization_executions_one_running_idx
  on app_private.document_materialization_executions(
    tenant_id, materialization_id
  ) where status='running';
create index document_materialization_executions_lease_idx
  on app_private.document_materialization_executions(
    leased_until, execution_id
  ) where status='running';
create index document_materialization_executions_job_fk_idx
  on app_private.document_materialization_executions(
    tenant_id, materialization_id
  );
create index document_materialization_executions_artifact_fk_idx
  on app_private.document_materialization_executions(tenant_id, artifact_id)
  where artifact_id is not null;

alter table app_private.document_materialization_jobs enable row level security;
alter table app_private.document_materialization_jobs force row level security;
alter table app_private.document_materialization_executions enable row level security;
alter table app_private.document_materialization_executions force row level security;

create policy document_materialization_migrator_jobs
  on app_private.document_materialization_jobs for all to app_migrator
  using (true) with check (true);
create policy document_materialization_migrator_executions
  on app_private.document_materialization_executions for all to app_migrator
  using (true) with check (true);

create function app_private.request_tenant_document_materialization(
  p_case_id uuid,
  p_document_id uuid,
  p_materialization_id uuid,
  p_requested_at timestamptz
)
returns table (materialization_id uuid, document_id uuid, state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  current_user_id uuid := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  eligible record;
  existing_id uuid;
  artifact_ready boolean;
  result_status text;
begin
  if p_case_id is null or p_document_id is null
     or p_materialization_id is null or p_requested_at is null
     or current_tenant_id is null or current_user_id is null
     or p_requested_at < statement_timestamp() - interval '5 minutes'
     or p_requested_at > statement_timestamp() + interval '1 minute' then
    raise exception 'invalid document materialization request'
      using errcode='22023';
  end if;
  if not app_private.tenant_case_is_visible(p_case_id) then
    return;
  end if;

  select record.document_id into eligible
    from app_private.document_records record
    join app_private.sources source on source.source_id=record.source_id
   where record.tenant_id=current_tenant_id
     and record.case_id=p_case_id
     and record.document_id=p_document_id
     and record.access_class='public_official'
     and record.expected_media_type='application/pdf'
     and source.status='active'
     and source.terms_reviewed_at is not null;
  if not found then return; end if;

  select exists (
    select 1 from app_private.document_artifacts artifact
     where artifact.tenant_id=current_tenant_id
       and artifact.document_id=p_document_id
       and artifact.malware_scan_status='clean'
       and artifact.deleted_at is null
       and artifact.expires_at > p_requested_at
  ) into artifact_ready;

  select job.materialization_id into existing_id
    from app_private.document_materialization_jobs job
   where job.tenant_id=current_tenant_id
     and job.document_id=p_document_id;

  if artifact_ready then
    if existing_id is null then
      insert into app_private.document_materialization_jobs (
        tenant_id, materialization_id, document_id, requested_by_user_id,
        status, attempt_count, next_attempt_at, requested_at, completed_at
      ) values (
        current_tenant_id, p_materialization_id, p_document_id, current_user_id,
        'completed', 0, null, p_requested_at, p_requested_at
      );
      existing_id := p_materialization_id;
    end if;
    return query select existing_id, p_document_id, 'available'::text;
    return;
  end if;

  insert into app_private.document_materialization_jobs as job (
    tenant_id, materialization_id, document_id, requested_by_user_id,
    status, attempt_count, next_attempt_at, last_failure_code,
    requested_at, completed_at, created_at, updated_at
  ) values (
    current_tenant_id, p_materialization_id, p_document_id, current_user_id,
    'pending', 0, p_requested_at, null, p_requested_at, null,
    p_requested_at, p_requested_at
  )
  on conflict on constraint
    document_materialization_jobs_tenant_id_document_id_key do update
    set requested_by_user_id=excluded.requested_by_user_id,
        status=case
          when job.status='running' then 'running'
          when job.status in ('pending', 'retry') then job.status
          else 'pending'
        end,
        attempt_count=case
          when job.status in ('completed', 'dead') then 0
          else job.attempt_count
        end,
        next_attempt_at=case
          when job.status='running' then null
          when job.status in ('pending', 'retry')
            then least(job.next_attempt_at, excluded.next_attempt_at)
          else excluded.next_attempt_at
        end,
        last_failure_code=case
          when job.status='retry' then job.last_failure_code
          else null
        end,
        requested_at=excluded.requested_at,
        completed_at=null,
        updated_at=excluded.updated_at
  returning job.materialization_id, job.status
    into existing_id, result_status;

  return query select existing_id, p_document_id,
    case when result_status='running' then 'processing' else 'queued' end;
end
$$;

create function app_private.claim_document_materialization(
  p_execution_id uuid,
  p_worker_id text,
  p_now timestamptz,
  p_leased_until timestamptz,
  p_lease_token_hash bytea
)
returns table (
  execution_id uuid, tenant_id uuid, materialization_id uuid,
  document_id uuid, source_code text, external_document_id text,
  expected_media_type text, attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare selected record;
begin
  if p_execution_id is null
     or p_worker_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_now is null
     or p_leased_until < p_now + interval '30 seconds'
     or p_leased_until > p_now + interval '15 minutes'
     or octet_length(p_lease_token_hash) <> 32 then
    raise exception 'invalid document materialization claim'
      using errcode='22023';
  end if;

  update app_private.document_materialization_executions execution
     set status='expired', finished_at=p_now, updated_at=p_now
   where execution.status='running' and execution.leased_until <= p_now;

  update app_private.document_materialization_jobs job
     set status='retry', next_attempt_at=p_now,
         last_failure_code='LEASE_EXPIRED', updated_at=p_now
   where job.status='running'
     and not exists (
       select 1 from app_private.document_materialization_executions execution
        where execution.tenant_id=job.tenant_id
          and execution.materialization_id=job.materialization_id
          and execution.status='running'
     )
     and exists (
       select 1 from app_private.document_materialization_executions execution
        where execution.tenant_id=job.tenant_id
          and execution.materialization_id=job.materialization_id
          and execution.status='expired'
     );

  update app_private.document_materialization_jobs job
     set status='completed', next_attempt_at=null, last_failure_code=null,
         completed_at=p_now, updated_at=p_now
   where job.status in ('pending', 'retry')
     and exists (
       select 1 from app_private.document_artifacts artifact
        where artifact.tenant_id=job.tenant_id
          and artifact.document_id=job.document_id
          and artifact.malware_scan_status='clean'
          and artifact.deleted_at is null
          and artifact.expires_at > p_now
     );

  select job.tenant_id, job.materialization_id, job.document_id,
         job.attempt_count, source.source_code,
         document.external_document_id, document.expected_media_type
    into selected
    from app_private.document_materialization_jobs job
    join app_private.document_records document
      on document.tenant_id=job.tenant_id
     and document.document_id=job.document_id
     and document.access_class='public_official'
     and document.expected_media_type='application/pdf'
    join app_private.sources source
      on source.source_id=document.source_id
     and source.status='active'
     and source.terms_reviewed_at is not null
   where job.status in ('pending', 'retry')
     and job.next_attempt_at <= p_now
     and job.attempt_count < 20
   order by job.next_attempt_at, job.materialization_id
   for update of job skip locked
   limit 1;
  if not found then return; end if;

  insert into app_private.document_materialization_executions (
    execution_id, tenant_id, materialization_id, worker_id,
    lease_token_hash, leased_until, attempt_number, status, started_at
  ) values (
    p_execution_id, selected.tenant_id, selected.materialization_id,
    p_worker_id, p_lease_token_hash, p_leased_until,
    selected.attempt_count + 1, 'running', p_now
  );
  update app_private.document_materialization_jobs job
     set status='running', attempt_count=selected.attempt_count + 1,
         next_attempt_at=null, updated_at=p_now
   where job.tenant_id=selected.tenant_id
     and job.materialization_id=selected.materialization_id;

  return query select p_execution_id, selected.tenant_id,
    selected.materialization_id, selected.document_id, selected.source_code,
    selected.external_document_id, selected.expected_media_type,
    selected.attempt_count + 1;
end
$$;

create function app_private.complete_document_materialization(
  p_execution_id uuid,
  p_lease_token_hash bytea,
  p_completed_at timestamptz,
  p_artifact_id uuid,
  p_storage_object_id text,
  p_content_hash text,
  p_media_type text,
  p_size_bytes integer,
  p_expires_at timestamptz,
  p_encryption_key_version text,
  p_outcome_fingerprint bytea,
  p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  execution record;
  job record;
  accepted_artifact uuid;
begin
  if p_execution_id is null or octet_length(p_lease_token_hash) <> 32
     or p_completed_at is null or p_artifact_id is null
     or p_content_hash !~ '^sha256:[a-f0-9]{64}$'
     or p_media_type <> 'application/pdf'
     or p_size_bytes not between 1 and 26214400
     or p_expires_at < p_completed_at + interval '1 hour'
     or p_expires_at > p_completed_at + interval '7 days'
     or p_encryption_key_version !~ '^v[1-9][0-9]{0,8}$'
     or octet_length(p_outcome_fingerprint) <> 32 or p_event_id is null
     or length(p_storage_object_id) not between 64 and 512
     or p_storage_object_id ~ '://' or p_storage_object_id ~ '[[:cntrl:]]' then
    raise exception 'invalid document materialization completion'
      using errcode='22023';
  end if;

  select item.* into execution
    from app_private.document_materialization_executions item
   where item.execution_id=p_execution_id for update;
  if not found or execution.lease_token_hash <> p_lease_token_hash then
    return false;
  end if;
  if execution.status='completed' then
    return execution.outcome_fingerprint=p_outcome_fingerprint;
  end if;
  if execution.status <> 'running' or p_completed_at >= execution.leased_until then
    return false;
  end if;

  select item.* into job
    from app_private.document_materialization_jobs item
   where item.tenant_id=execution.tenant_id
     and item.materialization_id=execution.materialization_id
     and item.status='running'
   for update;
  if not found then return false; end if;
  if p_storage_object_id <>
     'documents/tenant/' || execution.tenant_id::text || '/' ||
     job.document_id::text || '/' || p_artifact_id::text || '.pdf' then
    raise exception 'invalid document materialization locator'
      using errcode='22023';
  end if;

  insert into app_private.document_artifacts as artifact (
    tenant_id, artifact_id, document_id, scope_kind, storage_object_id,
    content_hash, media_type, size_bytes, malware_scan_status,
    encryption_key_version, created_at, expires_at
  ) values (
    execution.tenant_id, p_artifact_id, job.document_id, 'tenant_private',
    p_storage_object_id, p_content_hash, p_media_type, p_size_bytes, 'clean',
    p_encryption_key_version, p_completed_at, p_expires_at
  )
  on conflict (tenant_id, document_id, content_hash) do update
    set expires_at=greatest(artifact.expires_at, excluded.expires_at)
    where artifact.artifact_id=excluded.artifact_id
      and artifact.storage_object_id=excluded.storage_object_id
      and artifact.media_type=excluded.media_type
      and artifact.size_bytes=excluded.size_bytes
      and artifact.malware_scan_status='clean'
      and artifact.encryption_key_version=excluded.encryption_key_version
      and artifact.deleted_at is null
  returning artifact.artifact_id into accepted_artifact;
  if accepted_artifact is null then return false; end if;

  update app_private.document_records document
     set availability_status='available',
         last_verified_at=greatest(document.last_verified_at, p_completed_at),
         updated_at=p_completed_at
   where document.tenant_id=execution.tenant_id
     and document.document_id=job.document_id;
  update app_private.document_materialization_jobs item
     set status='completed', next_attempt_at=null, last_failure_code=null,
         completed_at=p_completed_at, updated_at=p_completed_at
   where item.tenant_id=execution.tenant_id
     and item.materialization_id=execution.materialization_id;
  update app_private.document_materialization_executions item
     set status='completed', artifact_id=p_artifact_id,
         outcome_fingerprint=p_outcome_fingerprint,
         finished_at=p_completed_at, updated_at=p_completed_at
   where item.execution_id=p_execution_id;
  insert into app_private.outbox_events (
    event_id, tenant_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload, available_at
  ) values (
    p_event_id, execution.tenant_id,
    'document.materialization.completed.v1', 'document_materialization',
    execution.materialization_id, p_execution_id,
    jsonb_build_object(
      'materializationId', execution.materialization_id,
      'documentId', job.document_id,
      'artifactId', p_artifact_id
    ), p_completed_at
  );
  return true;
end
$$;

create function app_private.fail_document_materialization(
  p_execution_id uuid,
  p_lease_token_hash bytea,
  p_failed_at timestamptz,
  p_failure_code text,
  p_next_attempt_at timestamptz,
  p_terminal boolean,
  p_outcome_fingerprint bytea,
  p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare execution record;
begin
  if p_execution_id is null or octet_length(p_lease_token_hash) <> 32
     or p_failed_at is null
     or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
     or p_terminal is null
     or (p_terminal and p_next_attempt_at is not null)
     or (not p_terminal and (p_next_attempt_at is null
       or p_next_attempt_at <= p_failed_at))
     or octet_length(p_outcome_fingerprint) <> 32 or p_event_id is null then
    raise exception 'invalid document materialization failure'
      using errcode='22023';
  end if;
  select item.* into execution
    from app_private.document_materialization_executions item
   where item.execution_id=p_execution_id for update;
  if not found or execution.lease_token_hash <> p_lease_token_hash then
    return false;
  end if;
  if execution.status='failed' then
    return execution.outcome_fingerprint=p_outcome_fingerprint;
  end if;
  if execution.status <> 'running' or p_failed_at >= execution.leased_until then
    return false;
  end if;
  if not exists (
    select 1 from app_private.document_materialization_jobs job
     where job.tenant_id=execution.tenant_id
       and job.materialization_id=execution.materialization_id
       and job.status='running' for update
  ) then return false; end if;

  update app_private.document_materialization_jobs job
     set status=case when p_terminal then 'dead' else 'retry' end,
         next_attempt_at=p_next_attempt_at,
         last_failure_code=p_failure_code,
         completed_at=null,
         updated_at=p_failed_at
   where job.tenant_id=execution.tenant_id
     and job.materialization_id=execution.materialization_id;
  update app_private.document_materialization_executions item
     set status='failed', failure_code=p_failure_code,
         outcome_fingerprint=p_outcome_fingerprint,
         finished_at=p_failed_at, updated_at=p_failed_at
   where item.execution_id=p_execution_id;
  insert into app_private.outbox_events (
    event_id, tenant_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload, available_at
  ) values (
    p_event_id, execution.tenant_id,
    'document.materialization.failed.v1', 'document_materialization',
    execution.materialization_id, p_execution_id,
    jsonb_build_object(
      'materializationId', execution.materialization_id,
      'failureCode', p_failure_code,
      'terminal', p_terminal
    ), p_failed_at
  );
  return true;
end
$$;

revoke all on table app_private.document_materialization_jobs,
  app_private.document_materialization_executions
  from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.request_tenant_document_materialization(
  uuid, uuid, uuid, timestamptz
) from public, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.claim_document_materialization(
  uuid, text, timestamptz, timestamptz, bytea
) from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.complete_document_materialization(
  uuid, bytea, timestamptz, uuid, text, text, text, integer,
  timestamptz, text, bytea, uuid
) from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.fail_document_materialization(
  uuid, bytea, timestamptz, text, timestamptz, boolean, bytea, uuid
) from public, app_runtime, app_worker, app_dispatcher;

grant execute on function app_private.request_tenant_document_materialization(
  uuid, uuid, uuid, timestamptz
) to app_runtime;
grant execute on function app_private.claim_document_materialization(
  uuid, text, timestamptz, timestamptz, bytea
) to app_document_worker;
grant execute on function app_private.complete_document_materialization(
  uuid, bytea, timestamptz, uuid, text, text, text, integer,
  timestamptz, text, bytea, uuid
) to app_document_worker;
grant execute on function app_private.fail_document_materialization(
  uuid, bytea, timestamptz, text, timestamptz, boolean, bytea, uuid
) to app_document_worker;

reset role;
commit;
