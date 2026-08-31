begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname='app_lifecycle_worker') then
    create role app_lifecycle_worker
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

grant usage on schema app_private to app_lifecycle_worker;

create table app_private.tenant_data_lifecycle_requests (
  tenant_id uuid not null,
  request_id uuid not null,
  requested_by_user_id uuid not null,
  request_type text not null check (request_type in ('export', 'deletion')),
  status text not null check (
    status in ('pending', 'running', 'completed', 'failed', 'expired')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz,
  worker_id text check (
    worker_id is null or worker_id ~ '^[A-Za-z0-9._:-]{1,100}$'
  ),
  lease_token_hash bytea check (
    lease_token_hash is null or octet_length(lease_token_hash) = 32
  ),
  leased_until timestamptz,
  last_failure_code text check (
    last_failure_code is null or
    last_failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  export_schema_version integer check (
    export_schema_version is null or export_schema_version between 1 and 1000
  ),
  artifact_id uuid,
  artifact_object_id text check (
    artifact_object_id is null or (
      length(artifact_object_id) between 80 and 240 and
      artifact_object_id !~ '://' and
      artifact_object_id !~ '[[:cntrl:]]'
    )
  ),
  artifact_sha256 text check (
    artifact_sha256 is null or artifact_sha256 ~ '^sha256:[a-f0-9]{64}$'
  ),
  artifact_size_bytes bigint check (
    artifact_size_bytes is null or artifact_size_bytes between 1 and 10485760
  ),
  artifact_expires_at timestamptz,
  requested_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, request_id),
  unique (request_id),
  foreign key (tenant_id, requested_by_user_id)
    references app_private.tenant_members(tenant_id, user_id),
  check (updated_at >= created_at),
  check (started_at is null or started_at >= requested_at),
  check (completed_at is null or completed_at >= requested_at),
  check (expired_at is null or expired_at >= completed_at),
  check (
    (status = 'pending' and next_attempt_at is not null and
      worker_id is null and lease_token_hash is null and leased_until is null and
      completed_at is null and expired_at is null)
    or
    (status = 'running' and next_attempt_at is null and
      worker_id is not null and lease_token_hash is not null and
      leased_until is not null and started_at is not null and
      completed_at is null and expired_at is null)
    or
    (status = 'completed' and next_attempt_at is null and
      worker_id is null and lease_token_hash is null and leased_until is null and
      completed_at is not null and expired_at is null)
    or
    (status = 'failed' and next_attempt_at is null and
      worker_id is null and lease_token_hash is null and leased_until is null and
      completed_at is not null and expired_at is null and
      last_failure_code is not null)
    or
    (status = 'expired' and request_type = 'export' and
      next_attempt_at is null and worker_id is null and
      lease_token_hash is null and leased_until is null and
      completed_at is not null and expired_at is not null)
  ),
  check (
    (request_type = 'deletion' and export_schema_version is null and
      artifact_id is null and artifact_object_id is null and
      artifact_sha256 is null and artifact_size_bytes is null and
      artifact_expires_at is null)
    or
    (request_type = 'export' and status in ('pending', 'running', 'failed') and
      export_schema_version is null and artifact_id is null and
      artifact_object_id is null and artifact_sha256 is null and
      artifact_size_bytes is null and artifact_expires_at is null)
    or
    (request_type = 'export' and status in ('completed', 'expired') and
      export_schema_version is not null and artifact_id is not null and
      artifact_object_id is not null and artifact_sha256 is not null and
      artifact_size_bytes is not null and artifact_expires_at is not null)
  )
);

create unique index tenant_data_lifecycle_one_open_type_idx
  on app_private.tenant_data_lifecycle_requests(tenant_id, request_type)
  where status in ('pending', 'running');
create index tenant_data_lifecycle_due_idx
  on app_private.tenant_data_lifecycle_requests(
    next_attempt_at, requested_at, request_id
  ) where status = 'pending';
create index tenant_data_lifecycle_expiry_idx
  on app_private.tenant_data_lifecycle_requests(
    artifact_expires_at, request_id
  ) where request_type = 'export' and status = 'completed';
create index tenant_data_lifecycle_requester_fk_idx
  on app_private.tenant_data_lifecycle_requests(
    tenant_id, requested_by_user_id
  );

create table app_private.tenant_deletion_tombstones (
  tenant_id uuid primary key,
  request_id uuid not null unique,
  policy_version text not null check (
    policy_version ~ '^tenant-lifecycle-v[1-9][0-9]*$'
  ),
  purged_row_count bigint not null check (purged_row_count >= 0),
  purged_object_count bigint not null check (purged_object_count >= 0),
  deleted_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (tenant_id, request_id)
    references app_private.tenant_data_lifecycle_requests(tenant_id, request_id),
  check (created_at >= deleted_at)
);

alter table app_private.tenant_data_lifecycle_requests enable row level security;
alter table app_private.tenant_data_lifecycle_requests force row level security;
alter table app_private.tenant_deletion_tombstones enable row level security;
alter table app_private.tenant_deletion_tombstones force row level security;

create policy lifecycle_migrator_requests
  on app_private.tenant_data_lifecycle_requests for all to app_migrator
  using (true) with check (true);
create policy lifecycle_migrator_tombstones
  on app_private.tenant_deletion_tombstones for all to app_migrator
  using (true) with check (true);
create policy lifecycle_migrator_users
  on app_private.user_accounts for all to app_migrator
  using (true) with check (true);
create policy lifecycle_migrator_tenants
  on app_private.tenants for all to app_migrator
  using (true) with check (true);
create policy lifecycle_migrator_memberships
  on app_private.tenant_members for all to app_migrator
  using (true) with check (true);

create function app_private.request_tenant_data_export(
  p_request_id uuid,
  p_requested_at timestamptz
)
returns table (
  request_id uuid, request_type text, state text, requested_at timestamptz
)
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
  existing record;
begin
  if p_request_id is null or p_requested_at is null or
     current_tenant_id is null or current_user_id is null then
    raise exception 'invalid tenant export request' using errcode='22023';
  end if;

  select item.request_id, item.request_type, item.status, item.requested_at
    into existing
    from app_private.tenant_data_lifecycle_requests item
   where item.tenant_id=current_tenant_id
     and item.request_id=p_request_id
     and item.request_type='export';
  if found then
    return query select existing.request_id, existing.request_type,
      existing.status, existing.requested_at;
    return;
  end if;

  if not exists (
    select 1
      from app_private.tenants tenant
      join app_private.tenant_members member
        on member.tenant_id=tenant.tenant_id
       and member.user_id=current_user_id
       and member.membership_role='owner'
       and member.active=true
     where tenant.tenant_id=current_tenant_id
       and tenant.tenant_kind='personal'
       and tenant.status='active'
       and tenant.personal_owner_user_id=current_user_id
  ) then
    raise exception 'tenant lifecycle access denied' using errcode='42501';
  end if;

  select item.request_id, item.request_type, item.status, item.requested_at
    into existing
    from app_private.tenant_data_lifecycle_requests item
   where item.tenant_id=current_tenant_id
     and item.request_type='export'
     and item.status in ('pending', 'running')
   order by item.requested_at, item.request_id
   limit 1;
  if found then
    return query select existing.request_id, existing.request_type,
      existing.status, existing.requested_at;
    return;
  end if;

  insert into app_private.tenant_data_lifecycle_requests (
    tenant_id, request_id, requested_by_user_id, request_type, status,
    next_attempt_at, requested_at, created_at, updated_at
  ) values (
    current_tenant_id, p_request_id, current_user_id, 'export', 'pending',
    p_requested_at, p_requested_at, p_requested_at, p_requested_at
  );
  return query select p_request_id, 'export'::text, 'pending'::text,
    p_requested_at;
end
$$;

create function app_private.request_personal_tenant_deletion(
  p_request_id uuid,
  p_requested_at timestamptz,
  p_confirmed boolean
)
returns table (
  request_id uuid, request_type text, state text, requested_at timestamptz
)
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
  existing record;
begin
  if p_request_id is null or p_requested_at is null or p_confirmed is not true or
     current_tenant_id is null or current_user_id is null then
    raise exception 'invalid personal tenant deletion request'
      using errcode='22023';
  end if;

  select item.request_id, item.request_type, item.status, item.requested_at
    into existing
    from app_private.tenant_data_lifecycle_requests item
   where item.tenant_id=current_tenant_id
     and item.request_id=p_request_id
     and item.request_type='deletion';
  if found then
    return query select existing.request_id, existing.request_type,
      existing.status, existing.requested_at;
    return;
  end if;

  perform 1
    from app_private.tenants tenant
    join app_private.tenant_members member
      on member.tenant_id=tenant.tenant_id
     and member.user_id=current_user_id
     and member.membership_role='owner'
     and member.active=true
   where tenant.tenant_id=current_tenant_id
     and tenant.tenant_kind='personal'
     and tenant.status='active'
     and tenant.personal_owner_user_id=current_user_id
   for update of tenant;
  if not found then
    raise exception 'tenant lifecycle access denied' using errcode='42501';
  end if;

  update app_private.tenant_data_lifecycle_requests item
     set status='failed', next_attempt_at=null, worker_id=null,
         lease_token_hash=null, leased_until=null,
         last_failure_code='TENANT_DELETING', completed_at=p_requested_at,
         updated_at=p_requested_at
   where item.tenant_id=current_tenant_id
     and item.request_type='export'
     and item.status in ('pending', 'running');

  insert into app_private.tenant_data_lifecycle_requests (
    tenant_id, request_id, requested_by_user_id, request_type, status,
    next_attempt_at, requested_at, created_at, updated_at
  ) values (
    current_tenant_id, p_request_id, current_user_id, 'deletion', 'pending',
    p_requested_at, p_requested_at, p_requested_at, p_requested_at
  );

  update app_private.tenants tenant
     set status='deleting', version=version + 1, updated_at=p_requested_at
   where tenant.tenant_id=current_tenant_id;
  update app_private.tenant_members member
     set active=false, version=version + 1, updated_at=p_requested_at
   where member.tenant_id=current_tenant_id and member.active=true;
  update app_private.monitoring_targets target
     set status='inactive', next_check_at=null,
         version=version + 1, updated_at=p_requested_at
   where target.tenant_id=current_tenant_id and target.status='active';
  update app_private.target_source_states state
     set status='archived', next_attempt_at=null,
         version=version + 1, updated_at=p_requested_at
   where state.tenant_id=current_tenant_id and state.status <> 'archived';

  return query select p_request_id, 'deletion'::text, 'pending'::text,
    p_requested_at;
end
$$;

create function app_private.claim_tenant_data_lifecycle(
  p_claim_id uuid,
  p_worker_id text,
  p_now timestamptz,
  p_leased_until timestamptz,
  p_lease_token_hash bytea
)
returns table (
  claim_id uuid, request_id uuid, tenant_id uuid, request_type text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare selected record;
begin
  if p_claim_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,100}$' or
     p_now is null or p_leased_until < p_now + interval '30 seconds' or
     p_leased_until > p_now + interval '15 minutes' or
     octet_length(p_lease_token_hash) <> 32 then
    raise exception 'invalid tenant lifecycle claim' using errcode='22023';
  end if;

  update app_private.tenant_data_lifecycle_requests item
     set status=case when item.attempt_count >= 3 then 'failed' else 'pending' end,
         next_attempt_at=case when item.attempt_count >= 3 then null else p_now end,
         worker_id=null, lease_token_hash=null, leased_until=null,
         last_failure_code='LEASE_EXPIRED',
         completed_at=case when item.attempt_count >= 3 then p_now else null end,
         updated_at=p_now
   where item.status='running' and item.leased_until <= p_now;

  select item.tenant_id, item.request_id, item.request_type, item.attempt_count
    into selected
    from app_private.tenant_data_lifecycle_requests item
    join app_private.tenants tenant on tenant.tenant_id=item.tenant_id
   where item.status='pending' and item.next_attempt_at <= p_now
     and item.attempt_count < 3
     and (
       (item.request_type='export' and tenant.status='active') or
       (item.request_type='deletion' and tenant.status='deleting')
     )
   order by item.next_attempt_at, item.requested_at, item.request_id
   for update of item skip locked
   limit 1;
  if not found then return; end if;

  update app_private.tenant_data_lifecycle_requests item
     set status='running', next_attempt_at=null, worker_id=p_worker_id,
         lease_token_hash=p_lease_token_hash, leased_until=p_leased_until,
         attempt_count=selected.attempt_count + 1,
         started_at=coalesce(item.started_at, p_now),
         last_failure_code=null, updated_at=p_now
   where item.tenant_id=selected.tenant_id
     and item.request_id=selected.request_id;

  return query select p_claim_id, selected.request_id, selected.tenant_id,
    selected.request_type, selected.attempt_count + 1;
end
$$;

create function app_private.complete_tenant_data_export(
  p_request_id uuid,
  p_lease_token_hash bytea,
  p_completed_at timestamptz,
  p_artifact_id uuid,
  p_artifact_sha256 text,
  p_artifact_size_bytes bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare item record;
declare locator text;
begin
  if p_request_id is null or octet_length(p_lease_token_hash) <> 32 or
     p_completed_at is null or p_artifact_id is null or
     p_artifact_sha256 !~ '^sha256:[a-f0-9]{64}$' or
     p_artifact_size_bytes not between 1 and 10485760 then
    raise exception 'invalid tenant export completion' using errcode='22023';
  end if;
  select request.* into item
    from app_private.tenant_data_lifecycle_requests request
   where request.request_id=p_request_id for update;
  if not found or item.request_type <> 'export' or
     item.status <> 'running' or
     item.lease_token_hash <> p_lease_token_hash or
     p_completed_at >= item.leased_until then
    return false;
  end if;
  locator := 'exports/' || item.tenant_id::text || '/' ||
    item.request_id::text || '/' || p_artifact_id::text || '.json';
  update app_private.tenant_data_lifecycle_requests request
     set status='completed', worker_id=null, lease_token_hash=null,
         leased_until=null, last_failure_code=null,
         export_schema_version=1, artifact_id=p_artifact_id,
         artifact_object_id=locator, artifact_sha256=p_artifact_sha256,
         artifact_size_bytes=p_artifact_size_bytes,
         artifact_expires_at=p_completed_at + interval '24 hours',
         completed_at=p_completed_at, updated_at=p_completed_at
   where request.tenant_id=item.tenant_id and request.request_id=item.request_id;
  return true;
end
$$;

create function app_private.fail_tenant_data_lifecycle(
  p_request_id uuid,
  p_lease_token_hash bytea,
  p_failed_at timestamptz,
  p_failure_code text,
  p_next_attempt_at timestamptz,
  p_terminal boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare item record;
declare terminal_failure boolean;
begin
  if p_request_id is null or octet_length(p_lease_token_hash) <> 32 or
     p_failed_at is null or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,63}$' or
     p_terminal is null or (not p_terminal and
       (p_next_attempt_at is null or p_next_attempt_at <= p_failed_at)) then
    raise exception 'invalid tenant lifecycle failure' using errcode='22023';
  end if;
  select request.* into item
    from app_private.tenant_data_lifecycle_requests request
   where request.request_id=p_request_id for update;
  if not found or item.status <> 'running' or
     item.lease_token_hash <> p_lease_token_hash or
     p_failed_at >= item.leased_until then
    return false;
  end if;
  terminal_failure := p_terminal or item.attempt_count >= 3;
  update app_private.tenant_data_lifecycle_requests request
     set status=case when terminal_failure then 'failed' else 'pending' end,
         next_attempt_at=case when terminal_failure then null
           else p_next_attempt_at end,
         worker_id=null, lease_token_hash=null, leased_until=null,
         last_failure_code=p_failure_code,
         completed_at=case when terminal_failure then p_failed_at else null end,
         updated_at=p_failed_at
   where request.tenant_id=item.tenant_id and request.request_id=item.request_id;
  return true;
end
$$;

create function app_private.expire_tenant_data_export(
  p_request_id uuid,
  p_expired_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_request_id is null or p_expired_at is null then
    raise exception 'invalid tenant export expiration' using errcode='22023';
  end if;
  update app_private.tenant_data_lifecycle_requests request
     set status='expired', expired_at=p_expired_at, updated_at=p_expired_at
   where request.request_id=p_request_id
     and request.request_type='export'
     and request.status='completed'
     and request.artifact_expires_at <= p_expired_at;
  return found;
end
$$;

create function app_private.purge_personal_tenant_data(
  p_request_id uuid,
  p_lease_token_hash bytea,
  p_deleted_at timestamptz,
  p_purged_object_count bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare item record;
declare owner_user_id uuid;
declare deleted_count bigint;
declare total_deleted bigint := 0;
begin
  if p_request_id is null or octet_length(p_lease_token_hash) <> 32 or
     p_deleted_at is null or p_purged_object_count < 0 then
    raise exception 'invalid personal tenant purge' using errcode='22023';
  end if;
  if exists (
    select 1 from app_private.tenant_deletion_tombstones tombstone
     where tombstone.request_id=p_request_id
  ) then return true; end if;

  select request.*, tenant.personal_owner_user_id into item
    from app_private.tenant_data_lifecycle_requests request
    join app_private.tenants tenant on tenant.tenant_id=request.tenant_id
   where request.request_id=p_request_id
     and request.request_type='deletion'
   for update of request, tenant;
  if not found or item.status <> 'running' or
     item.lease_token_hash <> p_lease_token_hash or
     p_deleted_at >= item.leased_until or item.status <> 'running' then
    return false;
  end if;
  owner_user_id := item.personal_owner_user_id;

  delete from app_private.document_download_outcomes where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.document_download_authorizations where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.document_download_windows where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.document_materialization_executions where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.document_materialization_jobs where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.document_artifacts where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.document_records where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.alerts where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.event_evidence where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.case_events where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.tenant_cases where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.case_external_references where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.case_records where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.canonical_observations where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.source_envelopes where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.consumer_inbox_receipts where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.monitoring_observation_receipts where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.monitoring_executions where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.outbox_events where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.target_source_states where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.subject_targets where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.monitoring_targets where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.monitored_subjects where tenant_id=item.tenant_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;
  delete from app_private.tenant_data_lifecycle_requests request
   where request.tenant_id=item.tenant_id and request.request_id <> p_request_id;
  get diagnostics deleted_count = row_count; total_deleted := total_deleted + deleted_count;

  update app_private.tenant_data_lifecycle_requests request
     set status='completed', worker_id=null, lease_token_hash=null,
         leased_until=null, last_failure_code=null,
         completed_at=p_deleted_at, updated_at=p_deleted_at
   where request.tenant_id=item.tenant_id and request.request_id=p_request_id;
  insert into app_private.tenant_deletion_tombstones (
    tenant_id, request_id, policy_version, purged_row_count,
    purged_object_count, deleted_at, created_at
  ) values (
    item.tenant_id, p_request_id, 'tenant-lifecycle-v1', total_deleted,
    p_purged_object_count, p_deleted_at, p_deleted_at
  );
  update app_private.tenants tenant
     set status='deleted', version=version + 1, updated_at=p_deleted_at
   where tenant.tenant_id=item.tenant_id;
  update app_private.tenant_members member
     set active=false, version=version + 1, updated_at=p_deleted_at
   where member.tenant_id=item.tenant_id and member.active=true;
  update app_private.user_accounts account
     set provider_subject='deleted:' || account.user_id::text,
         status='deleted', version=version + 1, updated_at=p_deleted_at
   where account.user_id=owner_user_id
     and not exists (
       select 1 from app_private.tenant_members member
        where member.user_id=account.user_id and member.active=true
     );
  return true;
end
$$;

revoke all on table app_private.tenant_data_lifecycle_requests,
  app_private.tenant_deletion_tombstones
  from public, app_runtime, app_worker, app_dispatcher,
    app_document_worker, app_lifecycle_worker;
revoke all on function app_private.request_tenant_data_export(
  uuid, timestamptz
) from public, app_worker, app_dispatcher, app_document_worker,
  app_lifecycle_worker;
revoke all on function app_private.request_personal_tenant_deletion(
  uuid, timestamptz, boolean
) from public, app_worker, app_dispatcher, app_document_worker,
  app_lifecycle_worker;
revoke all on function app_private.claim_tenant_data_lifecycle(
  uuid, text, timestamptz, timestamptz, bytea
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.complete_tenant_data_export(
  uuid, bytea, timestamptz, uuid, text, bigint
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.fail_tenant_data_lifecycle(
  uuid, bytea, timestamptz, text, timestamptz, boolean
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.expire_tenant_data_export(
  uuid, timestamptz
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.purge_personal_tenant_data(
  uuid, bytea, timestamptz, bigint
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;

grant execute on function app_private.request_tenant_data_export(
  uuid, timestamptz
) to app_runtime;
grant execute on function app_private.request_personal_tenant_deletion(
  uuid, timestamptz, boolean
) to app_runtime;
grant execute on function app_private.claim_tenant_data_lifecycle(
  uuid, text, timestamptz, timestamptz, bytea
) to app_lifecycle_worker;
grant execute on function app_private.complete_tenant_data_export(
  uuid, bytea, timestamptz, uuid, text, bigint
) to app_lifecycle_worker;
grant execute on function app_private.fail_tenant_data_lifecycle(
  uuid, bytea, timestamptz, text, timestamptz, boolean
) to app_lifecycle_worker;
grant execute on function app_private.expire_tenant_data_export(
  uuid, timestamptz
) to app_lifecycle_worker;
grant execute on function app_private.purge_personal_tenant_data(
  uuid, bytea, timestamptz, bigint
) to app_lifecycle_worker;

reset role;
commit;
