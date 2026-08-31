begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker
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

create table app_private.monitoring_executions (
  execution_id uuid primary key,
  tenant_id uuid not null,
  state_id uuid not null,
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  lease_token_hash bytea not null check (octet_length(lease_token_hash) = 32),
  leased_until timestamptz not null,
  status text not null check (
    status in ('running', 'completed', 'failed', 'expired')
  ),
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  outcome_fingerprint bytea check (octet_length(outcome_fingerprint) = 32),
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (tenant_id, execution_id),
  foreign key (tenant_id, state_id)
    references app_private.target_source_states(tenant_id, state_id),
  check (leased_until > started_at),
  check (
    (status = 'running' and finished_at is null and failure_code is null
      and outcome_fingerprint is null)
    or
    (status = 'expired' and finished_at is not null and failure_code is null
      and outcome_fingerprint is null)
    or
    (status = 'completed' and finished_at is not null and failure_code is null
      and outcome_fingerprint is not null)
    or
    (status = 'failed' and finished_at is not null and failure_code is not null
      and outcome_fingerprint is not null)
  )
);

create unique index monitoring_executions_one_running_idx
  on app_private.monitoring_executions(tenant_id, state_id)
  where status = 'running';

create index monitoring_executions_lease_idx
  on app_private.monitoring_executions(leased_until, execution_id)
  where status = 'running';

create table app_private.monitoring_observation_receipts (
  tenant_id uuid not null,
  execution_id uuid not null,
  external_id text not null check (length(external_id) between 1 and 255),
  content_hash text not null
    check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  parser_version text not null check (length(parser_version) between 1 and 100),
  collected_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (execution_id, external_id, content_hash),
  foreign key (tenant_id, execution_id)
    references app_private.monitoring_executions(tenant_id, execution_id)
);

create index monitoring_observation_receipts_tenant_idx
  on app_private.monitoring_observation_receipts(tenant_id, collected_at);

create table app_private.outbox_events (
  event_id uuid primary key,
  tenant_id uuid not null references app_private.tenants(tenant_id),
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9.]{2,99}\.v[1-9][0-9]*$'),
  aggregate_type text not null check (length(aggregate_type) between 2 and 64),
  aggregate_id uuid not null,
  correlation_id uuid not null,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and pg_column_size(payload) <= 4096
  ),
  status text not null default 'pending'
    check (status in ('pending', 'published', 'dead')),
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    (status = 'published' and published_at is not null)
    or (status <> 'published' and published_at is null)
  )
);

create index outbox_events_pending_idx
  on app_private.outbox_events(available_at, event_id)
  where status = 'pending';

alter table app_private.monitoring_executions enable row level security;
alter table app_private.monitoring_executions force row level security;
alter table app_private.monitoring_observation_receipts enable row level security;
alter table app_private.monitoring_observation_receipts force row level security;
alter table app_private.outbox_events enable row level security;
alter table app_private.outbox_events force row level security;

create policy worker_migrator_subjects
  on app_private.monitored_subjects for all to app_migrator
  using (true) with check (true);
create policy worker_migrator_targets
  on app_private.monitoring_targets for all to app_migrator
  using (true) with check (true);
create policy worker_migrator_links
  on app_private.subject_targets for all to app_migrator
  using (true) with check (true);
create policy worker_migrator_memberships
  on app_private.tenant_members for select to app_migrator using (true);
create policy worker_migrator_states
  on app_private.target_source_states for all to app_migrator
  using (true) with check (true);
create policy worker_migrator_executions
  on app_private.monitoring_executions for all to app_migrator
  using (true) with check (true);
create policy worker_migrator_receipts
  on app_private.monitoring_observation_receipts for all to app_migrator
  using (true) with check (true);
create policy worker_migrator_outbox
  on app_private.outbox_events for all to app_migrator
  using (true) with check (true);

create function app_private.claim_monitoring_work(
  p_execution_id uuid,
  p_worker_id text,
  p_now timestamptz,
  p_leased_until timestamptz,
  p_lease_token_hash bytea
)
returns table (
  execution_id uuid,
  tenant_id uuid,
  state_id uuid,
  target_id uuid,
  subject_id uuid,
  source_code text,
  subject_type text,
  encrypted_value text,
  key_version text,
  consecutive_failures integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected record;
begin
  if p_execution_id is null
     or p_worker_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_now is null
     or p_leased_until < p_now + interval '30 seconds'
     or p_leased_until > p_now + interval '15 minutes'
     or octet_length(p_lease_token_hash) <> 32 then
    raise exception 'invalid monitoring claim' using errcode = '22023';
  end if;

  update app_private.monitoring_executions
     set status = 'expired',
         finished_at = p_now,
         updated_at = p_now
   where status = 'running'
     and leased_until <= p_now;

  update app_private.target_source_states state
     set status = 'ready',
         next_attempt_at = p_now,
         version = version + 1,
         updated_at = p_now
   where state.status = 'running'
     and not exists (
       select 1
         from app_private.monitoring_executions execution
        where execution.tenant_id = state.tenant_id
          and execution.state_id = state.state_id
          and execution.status = 'running'
     )
     and exists (
       select 1
         from app_private.monitoring_executions execution
        where execution.tenant_id = state.tenant_id
          and execution.state_id = state.state_id
          and execution.status = 'expired'
     );

  select state.tenant_id,
         state.state_id,
         state.target_id,
         state.consecutive_failures,
         source.source_code,
         subject.subject_id,
         subject.subject_type,
         subject.encrypted_value,
         subject.key_version
    into selected
    from app_private.target_source_states state
    join app_private.monitoring_targets target
      on target.tenant_id = state.tenant_id
     and target.target_id = state.target_id
     and target.status = 'active'
    join app_private.sources source
      on source.source_id = state.source_id
     and source.status = 'active'
     and source.terms_reviewed_at is not null
    join lateral (
      select candidate.subject_id,
             candidate.subject_type,
             candidate.encrypted_value,
             candidate.key_version
        from app_private.subject_targets link
        join app_private.monitored_subjects candidate
          on candidate.tenant_id = link.tenant_id
         and candidate.subject_id = link.subject_id
         and candidate.status = 'active'
         and candidate.key_version <> 'legacy'
       where link.tenant_id = state.tenant_id
         and link.target_id = state.target_id
       order by candidate.subject_id
       limit 1
    ) subject on true
   where state.status in ('ready', 'backoff')
     and state.next_attempt_at <= p_now
   order by state.next_attempt_at, state.state_id
   for update of state skip locked
   limit 1;

  if not found then
    return;
  end if;

  insert into app_private.monitoring_executions (
    execution_id,
    tenant_id,
    state_id,
    worker_id,
    lease_token_hash,
    leased_until,
    status,
    started_at
  ) values (
    p_execution_id,
    selected.tenant_id,
    selected.state_id,
    p_worker_id,
    p_lease_token_hash,
    p_leased_until,
    'running',
    p_now
  );

  update app_private.target_source_states state_update
     set status = 'running',
         last_attempt_at = p_now,
         next_attempt_at = null,
         version = version + 1,
         updated_at = p_now
   where state_update.tenant_id = selected.tenant_id
     and state_update.state_id = selected.state_id;

  return query
  select p_execution_id,
         selected.tenant_id,
         selected.state_id,
         selected.target_id,
         selected.subject_id,
         selected.source_code,
         selected.subject_type,
         selected.encrypted_value,
         selected.key_version,
         selected.consecutive_failures;
end
$$;

create function app_private.complete_monitoring_work(
  p_execution_id uuid,
  p_lease_token_hash bytea,
  p_completed_at timestamptz,
  p_next_attempt_at timestamptz,
  p_observations jsonb,
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
  observation jsonb;
begin
  if p_execution_id is null
     or octet_length(p_lease_token_hash) <> 32
     or p_completed_at is null
     or p_next_attempt_at <= p_completed_at
     or jsonb_typeof(p_observations) <> 'array'
     or jsonb_array_length(p_observations) > 1000
     or octet_length(p_outcome_fingerprint) <> 32
     or p_event_id is null then
    raise exception 'invalid monitoring completion' using errcode = '22023';
  end if;

  select item.* into execution
    from app_private.monitoring_executions item
   where item.execution_id = p_execution_id
   for update;

  if not found or execution.lease_token_hash <> p_lease_token_hash then
    return false;
  end if;
  if execution.status = 'completed' then
    return execution.outcome_fingerprint = p_outcome_fingerprint;
  end if;
  if execution.status <> 'running' or p_completed_at >= execution.leased_until then
    return false;
  end if;
  if not exists (
    select 1 from app_private.target_source_states state
     where state.tenant_id = execution.tenant_id
       and state.state_id = execution.state_id
       and state.status = 'running'
     for update
  ) then
    return false;
  end if;

  for observation in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(observation) <> 'object'
       or (select count(*) from jsonb_object_keys(observation)) <> 4
       or not observation ?& array[
         'externalId', 'contentHash', 'parserVersion', 'collectedAt'
       ]
       or length(observation->>'externalId') not between 1 and 255
       or (observation->>'contentHash') !~ '^sha256:[a-f0-9]{64}$'
       or length(observation->>'parserVersion') not between 1 and 100 then
      raise exception 'invalid monitoring observation' using errcode = '22023';
    end if;
  end loop;

  insert into app_private.monitoring_observation_receipts (
    tenant_id,
    execution_id,
    external_id,
    content_hash,
    parser_version,
    collected_at
  )
  select execution.tenant_id,
         p_execution_id,
         value->>'externalId',
         value->>'contentHash',
         value->>'parserVersion',
         (value->>'collectedAt')::timestamptz
    from jsonb_array_elements(p_observations)
  on conflict (execution_id, external_id, content_hash) do nothing;

  update app_private.target_source_states
     set status = 'ready',
         last_success_at = p_completed_at,
         next_attempt_at = p_next_attempt_at,
         consecutive_failures = 0,
         version = version + 1,
         updated_at = p_completed_at
   where tenant_id = execution.tenant_id
     and state_id = execution.state_id;

  update app_private.monitoring_executions
     set status = 'completed',
         outcome_fingerprint = p_outcome_fingerprint,
         finished_at = p_completed_at,
         updated_at = p_completed_at
   where execution_id = p_execution_id;

  insert into app_private.outbox_events (
    event_id,
    tenant_id,
    event_type,
    aggregate_type,
    aggregate_id,
    correlation_id,
    payload,
    available_at
  ) values (
    p_event_id,
    execution.tenant_id,
    'monitoring.execution.completed.v1',
    'monitoring_execution',
    p_execution_id,
    p_execution_id,
    jsonb_build_object(
      'executionId', p_execution_id,
      'observationCount', jsonb_array_length(p_observations)
    ),
    p_completed_at
  );
  return true;
end
$$;

create function app_private.fail_monitoring_work(
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
declare
  execution record;
begin
  if p_execution_id is null
     or octet_length(p_lease_token_hash) <> 32
     or p_failed_at is null
     or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
     or (p_terminal and p_next_attempt_at is not null)
     or (not p_terminal and (
       p_next_attempt_at is null or p_next_attempt_at <= p_failed_at
     ))
     or octet_length(p_outcome_fingerprint) <> 32
     or p_event_id is null then
    raise exception 'invalid monitoring failure' using errcode = '22023';
  end if;

  select item.* into execution
    from app_private.monitoring_executions item
   where item.execution_id = p_execution_id
   for update;

  if not found or execution.lease_token_hash <> p_lease_token_hash then
    return false;
  end if;
  if execution.status = 'failed' then
    return execution.outcome_fingerprint = p_outcome_fingerprint;
  end if;
  if execution.status <> 'running' or p_failed_at >= execution.leased_until then
    return false;
  end if;
  if not exists (
    select 1 from app_private.target_source_states state
     where state.tenant_id = execution.tenant_id
       and state.state_id = execution.state_id
       and state.status = 'running'
     for update
  ) then
    return false;
  end if;

  update app_private.target_source_states
     set status = case when p_terminal then 'disabled' else 'backoff' end,
         next_attempt_at = p_next_attempt_at,
         consecutive_failures = consecutive_failures + 1,
         version = version + 1,
         updated_at = p_failed_at
   where tenant_id = execution.tenant_id
     and state_id = execution.state_id;

  update app_private.monitoring_executions
     set status = 'failed',
         failure_code = p_failure_code,
         outcome_fingerprint = p_outcome_fingerprint,
         finished_at = p_failed_at,
         updated_at = p_failed_at
   where execution_id = p_execution_id;

  insert into app_private.outbox_events (
    event_id,
    tenant_id,
    event_type,
    aggregate_type,
    aggregate_id,
    correlation_id,
    payload,
    available_at
  ) values (
    p_event_id,
    execution.tenant_id,
    'monitoring.execution.failed.v1',
    'monitoring_execution',
    p_execution_id,
    p_execution_id,
    jsonb_build_object(
      'executionId', p_execution_id,
      'failureCode', p_failure_code,
      'terminal', p_terminal
    ),
    p_failed_at
  );
  return true;
end
$$;

create function app_private.register_monitoring_profile(
  p_subject_id uuid,
  p_subject_type text,
  p_display_label text,
  p_protected_reference text,
  p_encrypted_value text,
  p_key_version text,
  p_target_id uuid,
  p_state_id uuid,
  p_source_code text,
  p_event_id uuid,
  p_scheduled_at timestamptz
)
returns table (
  tenant_id uuid,
  subject_id uuid,
  subject_type text,
  display_label text,
  status text,
  version bigint,
  archived_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  current_tenant_id uuid;
  selected_source record;
begin
  current_user_id := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  if current_user_id is null
     or current_tenant_id is null
     or p_subject_id is null
     or p_subject_type not in ('name', 'cpf', 'cnpj')
     or length(p_display_label) not between 1 and 200
     or p_target_id is null
     or p_state_id is null
     or p_event_id is null
     or p_scheduled_at is null then
    raise exception 'invalid monitoring profile registration' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app_private.tenant_members membership
     where membership.tenant_id = current_tenant_id
       and membership.user_id = current_user_id
       and membership.active = true
  ) then
    raise exception 'monitoring profile membership denied' using errcode = '42501';
  end if;

  select source.source_id,
         source.source_code,
         source.status,
         source.terms_reviewed_at
    into selected_source
    from app_private.sources source
   where source.source_code = p_source_code;
  if not found then
    raise exception 'monitoring source missing' using errcode = '23503';
  end if;

  insert into app_private.monitored_subjects (
    tenant_id,
    subject_id,
    subject_type,
    display_label,
    protected_reference,
    encrypted_value,
    key_version
  ) values (
    current_tenant_id,
    p_subject_id,
    p_subject_type,
    p_display_label,
    p_protected_reference,
    p_encrypted_value,
    p_key_version
  )
  on conflict on constraint monitored_subjects_pkey do nothing;

  if not exists (
    select 1 from app_private.monitored_subjects subject
     where subject.tenant_id = current_tenant_id
       and subject.subject_id = p_subject_id
       and subject.subject_type = p_subject_type
       and subject.display_label = p_display_label
       and subject.protected_reference = p_protected_reference
       and subject.encrypted_value = p_encrypted_value
       and subject.key_version = p_key_version
       and subject.status = 'active'
  ) then
    raise exception 'monitoring profile conflict' using errcode = '23505';
  end if;

  insert into app_private.monitoring_targets (
    tenant_id,
    target_id,
    target_type,
    display_label,
    protected_reference,
    jurisdiction
  ) values (
    current_tenant_id,
    p_target_id,
    p_subject_type,
    p_display_label,
    p_protected_reference,
    'BR'
  )
  on conflict on constraint monitoring_targets_pkey do nothing;

  if not exists (
    select 1 from app_private.monitoring_targets target
     where target.tenant_id = current_tenant_id
       and target.target_id = p_target_id
       and target.target_type = p_subject_type
       and target.display_label = p_display_label
       and target.protected_reference = p_protected_reference
       and target.jurisdiction = 'BR'
       and target.status = 'active'
  ) then
    raise exception 'monitoring target conflict' using errcode = '23505';
  end if;

  insert into app_private.subject_targets (tenant_id, subject_id, target_id)
  values (current_tenant_id, p_subject_id, p_target_id)
  on conflict on constraint subject_targets_pkey do nothing;

  insert into app_private.target_source_states (
    tenant_id,
    state_id,
    target_id,
    source_id,
    status,
    next_attempt_at
  ) values (
    current_tenant_id,
    p_state_id,
    p_target_id,
    selected_source.source_id,
    case
      when selected_source.status = 'active'
       and selected_source.terms_reviewed_at is not null then 'ready'
      else 'disabled'
    end,
    case
      when selected_source.status = 'active'
       and selected_source.terms_reviewed_at is not null then p_scheduled_at
      else null
    end
  )
  on conflict on constraint target_source_states_pkey do nothing;

  if not exists (
    select 1 from app_private.target_source_states state
     where state.tenant_id = current_tenant_id
       and state.state_id = p_state_id
       and state.target_id = p_target_id
       and state.source_id = selected_source.source_id
  ) then
    raise exception 'monitoring state conflict' using errcode = '23505';
  end if;

  insert into app_private.outbox_events (
    event_id,
    tenant_id,
    event_type,
    aggregate_type,
    aggregate_id,
    correlation_id,
    payload,
    available_at
  ) values (
    p_event_id,
    current_tenant_id,
    'monitoring.target.created.v1',
    'monitoring_target',
    p_target_id,
    p_event_id,
    jsonb_build_object(
      'subjectId', p_subject_id,
      'targetId', p_target_id,
      'stateId', p_state_id,
      'sourceCode', selected_source.source_code
    ),
    p_scheduled_at
  )
  on conflict on constraint outbox_events_pkey do nothing;

  if not exists (
    select 1 from app_private.outbox_events event
     where event.event_id = p_event_id
       and event.tenant_id = current_tenant_id
       and event.event_type = 'monitoring.target.created.v1'
       and event.aggregate_id = p_target_id
  ) then
    raise exception 'monitoring outbox conflict' using errcode = '23505';
  end if;

  return query
  select subject.tenant_id,
         subject.subject_id,
         subject.subject_type,
         subject.display_label,
         subject.status,
         subject.version,
         subject.archived_at
    from app_private.monitored_subjects subject
   where subject.tenant_id = current_tenant_id
     and subject.subject_id = p_subject_id;
end
$$;

revoke all on function app_private.claim_monitoring_work(
  uuid, text, timestamptz, timestamptz, bytea
) from public;
revoke all on function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) from public;
revoke all on function app_private.fail_monitoring_work(
  uuid, bytea, timestamptz, text, timestamptz, boolean, bytea, uuid
) from public;
revoke all on function app_private.register_monitoring_profile(
  uuid, text, text, text, text, text, uuid, uuid, text, uuid, timestamptz
) from public;

grant usage on schema app_private to app_worker;
grant execute on function app_private.claim_monitoring_work(
  uuid, text, timestamptz, timestamptz, bytea
) to app_worker;
grant execute on function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) to app_worker;
grant execute on function app_private.fail_monitoring_work(
  uuid, bytea, timestamptz, text, timestamptz, boolean, bytea, uuid
) to app_worker;
grant execute on function app_private.register_monitoring_profile(
  uuid, text, text, text, text, text, uuid, uuid, text, uuid, timestamptz
) to app_runtime;

reset role;

commit;
