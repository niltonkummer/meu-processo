begin;

set role app_migrator;

create table app_private.case_events (
  tenant_id uuid not null,
  case_event_id uuid not null,
  case_id uuid not null,
  source_id uuid not null references app_private.sources(source_id),
  event_type text not null check (event_type = 'publication'),
  external_event_key text not null check (length(external_event_key) between 1 and 255),
  occurred_at timestamptz not null,
  title text not null check (
    length(title) between 1 and 200 and title !~ '[[:cntrl:]]'
  ),
  plain_text_excerpt text check (
    length(plain_text_excerpt) <= 500
    and plain_text_excerpt !~ '[[:cntrl:]]'
  ),
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  schema_version smallint not null check (schema_version = 1),
  projected_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, case_event_id),
  unique (tenant_id, source_id, external_event_key),
  foreign key (tenant_id, case_id)
    references app_private.case_records(tenant_id, case_id)
);

create index case_events_timeline_idx
  on app_private.case_events(
    tenant_id, case_id, occurred_at desc, case_event_id desc
  );

create index case_events_source_fk_idx
  on app_private.case_events(source_id);

create table app_private.event_evidence (
  tenant_id uuid not null,
  event_evidence_id uuid not null,
  case_event_id uuid not null,
  envelope_id uuid not null,
  relation text not null check (relation = 'supports'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, event_evidence_id),
  unique (tenant_id, case_event_id, envelope_id),
  foreign key (tenant_id, case_event_id)
    references app_private.case_events(tenant_id, case_event_id),
  foreign key (tenant_id, envelope_id)
    references app_private.source_envelopes(tenant_id, envelope_id)
);

create index event_evidence_envelope_fk_idx
  on app_private.event_evidence(tenant_id, envelope_id);

alter table app_private.case_events enable row level security;
alter table app_private.case_events force row level security;
alter table app_private.event_evidence enable row level security;
alter table app_private.event_evidence force row level security;

create policy timeline_migrator_events
  on app_private.case_events for all to app_migrator
  using (true) with check (true);
create policy timeline_migrator_evidence
  on app_private.event_evidence for all to app_migrator
  using (true) with check (true);

alter function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) rename to complete_monitoring_work_case_evidence;

revoke all on function app_private.complete_monitoring_work_case_evidence(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) from public, app_worker;

create function app_private.complete_monitoring_work(
  p_execution_id uuid,
  p_lease_token_hash bytea,
  p_completed_at timestamptz,
  p_next_attempt_at timestamptz,
  p_evidence jsonb,
  p_outcome_fingerprint bytea,
  p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  base_evidence jsonb := '[]'::jsonb;
  execution record;
  resolved_envelope_id uuid;
  resolved_case_id uuid;
  resolved_case_event_id uuid;
  accepted boolean;
begin
  if jsonb_typeof(p_evidence) <> 'array'
     or jsonb_array_length(p_evidence) > 1000 then
    raise exception 'invalid timeline evidence' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_evidence)
  loop
    if jsonb_typeof(item) <> 'object'
       or (select count(*) from jsonb_object_keys(item)) <> 19
       or not item ?& array[
         'externalId', 'contentHash', 'parserVersion', 'schemaVersion',
         'cnjNumber', 'tribunalCode', 'collectedAt', 'envelopeId',
         'observationId', 'caseId', 'externalReferenceId', 'tenantCaseId',
         'eventType', 'externalEventKey', 'occurredAt', 'title',
         'plainTextExcerpt', 'caseEventId', 'eventEvidenceId'
       ]
       or item->>'eventType' <> 'publication'
       or length(item->>'externalEventKey') not between 1 and 255
       or length(item->>'title') not between 1 and 200
       or (item->>'title') ~ '[[:cntrl:]]'
       or jsonb_typeof(item->'plainTextExcerpt') not in ('string', 'null')
       or length(coalesce(item->>'plainTextExcerpt', '')) > 500
       or coalesce(item->>'plainTextExcerpt', '') ~ '[[:cntrl:]]'
       or (item->>'occurredAt')::timestamptz
          > (item->>'collectedAt')::timestamptz
       or (item->>'caseEventId')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (item->>'eventEvidenceId')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid canonical timeline event' using errcode = '22023';
    end if;

    base_evidence := base_evidence || jsonb_build_array(jsonb_build_object(
      'externalId', item->>'externalId',
      'contentHash', item->>'contentHash',
      'parserVersion', item->>'parserVersion',
      'schemaVersion', item->'schemaVersion',
      'cnjNumber', item->>'cnjNumber',
      'tribunalCode', item->>'tribunalCode',
      'collectedAt', item->>'collectedAt',
      'envelopeId', item->>'envelopeId',
      'observationId', item->>'observationId',
      'caseId', item->>'caseId',
      'externalReferenceId', item->>'externalReferenceId',
      'tenantCaseId', item->>'tenantCaseId'
    ));
  end loop;

  accepted := app_private.complete_monitoring_work_case_evidence(
    p_execution_id, p_lease_token_hash, p_completed_at, p_next_attempt_at,
    base_evidence, p_outcome_fingerprint, p_event_id
  );
  if not accepted then
    return false;
  end if;

  select monitoring.tenant_id, state.source_id
    into execution
    from app_private.monitoring_executions monitoring
    join app_private.target_source_states state
      on state.tenant_id = monitoring.tenant_id
     and state.state_id = monitoring.state_id
   where monitoring.execution_id = p_execution_id;

  for item in select value from jsonb_array_elements(p_evidence)
  loop
    select envelope.envelope_id into resolved_envelope_id
      from app_private.source_envelopes envelope
     where envelope.tenant_id = execution.tenant_id
       and envelope.source_id = execution.source_id
       and envelope.external_id = item->>'externalId'
       and envelope.content_hash = item->>'contentHash';

    select record.case_id into resolved_case_id
      from app_private.case_records record
     where record.tenant_id = execution.tenant_id
       and record.cnj_normalized = item->>'cnjNumber'
       and record.tribunal_code = item->>'tribunalCode';

    insert into app_private.case_events (
      tenant_id, case_event_id, case_id, source_id, event_type,
      external_event_key, occurred_at, title, plain_text_excerpt,
      content_hash, schema_version, projected_at
    ) values (
      execution.tenant_id, (item->>'caseEventId')::uuid, resolved_case_id,
      execution.source_id, 'publication', item->>'externalEventKey',
      (item->>'occurredAt')::timestamptz, item->>'title',
      item->>'plainTextExcerpt', item->>'contentHash', 1, p_completed_at
    )
    on conflict (tenant_id, source_id, external_event_key) do nothing;

    select event.case_event_id into resolved_case_event_id
      from app_private.case_events event
     where event.tenant_id = execution.tenant_id
       and event.source_id = execution.source_id
       and event.external_event_key = item->>'externalEventKey'
       and event.case_id = resolved_case_id
       and event.event_type = 'publication'
       and event.occurred_at = (item->>'occurredAt')::timestamptz
       and event.title = item->>'title'
       and event.plain_text_excerpt is not distinct from item->>'plainTextExcerpt'
       and event.content_hash = item->>'contentHash'
       and event.schema_version = 1;
    if not found then
      raise exception 'canonical timeline event conflict' using errcode = '23505';
    end if;

    insert into app_private.event_evidence (
      tenant_id, event_evidence_id, case_event_id, envelope_id, relation
    ) values (
      execution.tenant_id, (item->>'eventEvidenceId')::uuid,
      resolved_case_event_id, resolved_envelope_id, 'supports'
    )
    on conflict (tenant_id, case_event_id, envelope_id) do nothing;
  end loop;
  return true;
end
$$;

create function app_private.tenant_case_is_visible(p_case_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_user_id uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  current_tenant_id uuid := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
begin
  if current_user_id is null or current_tenant_id is null or p_case_id is null then
    raise exception 'invalid case visibility request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app_private.tenant_members membership
     where membership.tenant_id = current_tenant_id
       and membership.user_id = current_user_id and membership.active = true
  ) then
    raise exception 'case visibility denied' using errcode = '42501';
  end if;
  return exists (
    select 1 from app_private.tenant_cases tenant_case
     where tenant_case.tenant_id = current_tenant_id
       and tenant_case.case_id = p_case_id
       and tenant_case.access_status = 'active'
  );
end
$$;

create function app_private.list_tenant_case_events(
  p_case_id uuid,
  p_after_occurred_at timestamptz,
  p_after_event_id uuid,
  p_limit integer
)
returns table (
  tenant_id uuid, case_event_id uuid, case_id uuid, event_type text,
  occurred_at timestamptz, title text, plain_text_excerpt text, sources jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_tenant_id uuid := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
begin
  if not app_private.tenant_case_is_visible(p_case_id)
     or p_limit not between 1 and 101
     or ((p_after_occurred_at is null) <> (p_after_event_id is null)) then
    if p_limit not between 1 and 101
       or ((p_after_occurred_at is null) <> (p_after_event_id is null)) then
      raise exception 'invalid case timeline page' using errcode = '22023';
    end if;
    return;
  end if;

  return query
  select event.tenant_id, event.case_event_id, event.case_id, event.event_type,
         event.occurred_at, event.title, event.plain_text_excerpt,
         jsonb_agg(distinct jsonb_build_object(
           'sourceId', source.source_code,
           'official', source.source_class = 'official',
           'collectedAt', envelope.retrieved_at
         )) as sources
    from app_private.case_events event
    join app_private.event_evidence evidence
      on evidence.tenant_id = event.tenant_id
     and evidence.case_event_id = event.case_event_id
    join app_private.source_envelopes envelope
      on envelope.tenant_id = evidence.tenant_id
     and envelope.envelope_id = evidence.envelope_id
    join app_private.sources source on source.source_id = event.source_id
   where event.tenant_id = current_tenant_id
     and event.case_id = p_case_id
     and (p_after_occurred_at is null or
          (event.occurred_at, event.case_event_id) <
          (p_after_occurred_at, p_after_event_id))
   group by event.tenant_id, event.case_event_id, event.case_id,
            event.event_type, event.occurred_at, event.title,
            event.plain_text_excerpt
   order by event.occurred_at desc, event.case_event_id desc
   limit p_limit;
end
$$;

alter table app_private.alerts
  add column case_event_id uuid,
  add constraint alerts_case_event_fk
    foreign key (tenant_id, case_event_id)
    references app_private.case_events(tenant_id, case_event_id);

create index alerts_case_event_fk_idx
  on app_private.alerts(tenant_id, case_event_id);

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'app_private.alerts'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) like
       '%tenant_id, source_event_id, subject_id, tenant_case_id, alert_type%';
  if constraint_name is not null then
    execute format('alter table app_private.alerts drop constraint %I', constraint_name);
  end if;
end
$$;

alter table app_private.alerts
  add constraint alerts_event_profile_case_unique unique (
    tenant_id, source_event_id, subject_id, tenant_case_id,
    case_event_id, alert_type
  );

alter function app_private.project_internal_alerts(
  uuid, uuid, text, uuid, jsonb, timestamptz
) rename to project_internal_alerts_without_timeline;

revoke all on function app_private.project_internal_alerts_without_timeline(
  uuid, uuid, text, uuid, jsonb, timestamptz
) from public, app_dispatcher;

create function app_private.project_internal_alerts(
  p_event_id uuid, p_tenant_id uuid, p_event_type text,
  p_aggregate_id uuid, p_payload jsonb, p_processed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_event record;
  stored_receipt record;
  expected_hash bytea;
  projected_count integer := 0;
begin
  if p_event_id is null or p_tenant_id is null
     or p_event_type !~ '^[a-z][a-z0-9.]{2,99}\.v[1-9][0-9]*$'
     or p_aggregate_id is null or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 4096 or p_processed_at is null then
    raise exception 'invalid internal alert projection' using errcode = '22023';
  end if;
  select item.* into stored_event from app_private.outbox_events item
   where item.event_id = p_event_id for update;
  if not found or stored_event.tenant_id <> p_tenant_id
     or stored_event.event_type <> p_event_type
     or stored_event.aggregate_id <> p_aggregate_id
     or stored_event.payload <> p_payload or stored_event.status <> 'pending'
     or stored_event.claimed_by is null
     or p_processed_at < stored_event.last_attempt_at
     or p_processed_at > stored_event.leased_until then
    raise exception 'internal alert event conflict' using errcode = '23505';
  end if;
  expected_hash := extensions.digest(convert_to(concat_ws(
    E'\x1f', stored_event.event_type, stored_event.aggregate_type,
    stored_event.aggregate_id::text, stored_event.payload::text
  ), 'UTF8'), 'sha256');
  select receipt.* into stored_receipt
    from app_private.consumer_inbox_receipts receipt
   where receipt.consumer_name = 'internal-alert-projector-v1'
     and receipt.event_id = p_event_id;
  if found then
    if stored_receipt.tenant_id <> p_tenant_id
       or stored_receipt.payload_hash <> expected_hash then
      raise exception 'internal alert receipt conflict' using errcode = '23505';
    end if;
    return 0;
  end if;

  if stored_event.event_type = 'monitoring.execution.completed.v1'
     and stored_event.aggregate_type = 'monitoring_execution' then
    insert into app_private.alerts (
      tenant_id, subject_id, tenant_case_id, case_id, case_event_id,
      source_event_id, alert_type, match_status, source_occurred_at,
      created_at, updated_at
    )
    select stored_event.tenant_id, subject.subject_id,
           tenant_case.tenant_case_id, case_record.case_id,
           case_event.case_event_id, stored_event.event_id,
           'case_discovered', 'unverified', case_event.occurred_at,
           p_processed_at, p_processed_at
      from app_private.monitoring_executions execution
      join app_private.target_source_states state
        on state.tenant_id = execution.tenant_id and state.state_id = execution.state_id
      join app_private.subject_targets link
        on link.tenant_id = state.tenant_id and link.target_id = state.target_id
      join app_private.monitored_subjects subject
        on subject.tenant_id = link.tenant_id and subject.subject_id = link.subject_id
      join app_private.monitoring_observation_receipts receipt
        on receipt.tenant_id = execution.tenant_id and receipt.execution_id = execution.execution_id
      join app_private.source_envelopes envelope
        on envelope.tenant_id = receipt.tenant_id and envelope.source_id = state.source_id
       and envelope.external_id = receipt.external_id and envelope.content_hash = receipt.content_hash
      join app_private.canonical_observations observation
        on observation.tenant_id = envelope.tenant_id and observation.envelope_id = envelope.envelope_id
       and observation.parser_version = receipt.parser_version
      join app_private.case_records case_record
        on case_record.tenant_id = observation.tenant_id
       and case_record.cnj_normalized = observation.cnj_normalized
       and case_record.tribunal_code = observation.tribunal_code
      join app_private.tenant_cases tenant_case
        on tenant_case.tenant_id = case_record.tenant_id and tenant_case.case_id = case_record.case_id
       and tenant_case.access_status = 'active'
      join app_private.event_evidence event_link
        on event_link.tenant_id = envelope.tenant_id and event_link.envelope_id = envelope.envelope_id
      join app_private.case_events case_event
        on case_event.tenant_id = event_link.tenant_id
       and case_event.case_event_id = event_link.case_event_id
       and case_event.case_id = case_record.case_id
     where execution.tenant_id = stored_event.tenant_id
       and execution.execution_id = stored_event.aggregate_id
       and execution.status = 'completed'
    on conflict on constraint alerts_event_profile_case_unique do nothing;
    get diagnostics projected_count = row_count;
  end if;
  insert into app_private.consumer_inbox_receipts(
    consumer_name, event_id, tenant_id, payload_hash, processed_at
  ) values ('internal-alert-projector-v1', p_event_id, p_tenant_id,
            expected_hash, p_processed_at);
  return projected_count;
end
$$;

create function app_private.list_tenant_alerts_v2(
  p_status text, p_after_created_at timestamptz,
  p_after_alert_id uuid, p_limit integer
)
returns table (
  tenant_id uuid, alert_id uuid, subject_id uuid, subject_label text,
  tenant_case_id uuid, case_id uuid, case_event_id uuid,
  cnj_normalized text, tribunal_code text, alert_type text, status text,
  match_status text, source_occurred_at timestamptz,
  created_at timestamptz, read_at timestamptz
)
language plpgsql security definer stable set search_path = ''
as $$
declare
  current_user_id uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  current_tenant_id uuid := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
begin
  if current_user_id is null or current_tenant_id is null
     or p_status not in ('all','unread','read') or p_limit not between 1 and 101
     or ((p_after_created_at is null) <> (p_after_alert_id is null)) then
    raise exception 'invalid alert page' using errcode = '22023';
  end if;
  if not exists (select 1 from app_private.tenant_members membership
    where membership.tenant_id=current_tenant_id and membership.user_id=current_user_id
      and membership.active=true) then
    raise exception 'alert membership denied' using errcode = '42501';
  end if;
  return query
  select alert.tenant_id, alert.alert_id, subject.subject_id, subject.display_label,
         tenant_case.tenant_case_id, case_record.case_id, alert.case_event_id,
         case_record.cnj_normalized, case_record.tribunal_code, alert.alert_type,
         alert.status, alert.match_status, alert.source_occurred_at,
         alert.created_at, alert.read_at
    from app_private.alerts alert
    join app_private.monitored_subjects subject
      on subject.tenant_id=alert.tenant_id and subject.subject_id=alert.subject_id
    join app_private.tenant_cases tenant_case
      on tenant_case.tenant_id=alert.tenant_id and tenant_case.tenant_case_id=alert.tenant_case_id
     and tenant_case.case_id=alert.case_id
    join app_private.case_records case_record
      on case_record.tenant_id=alert.tenant_id and case_record.case_id=alert.case_id
   where alert.tenant_id=current_tenant_id and alert.case_event_id is not null
     and (p_status='all' or alert.status=p_status)
     and (p_after_created_at is null or
          (alert.created_at,alert.alert_id)<(p_after_created_at,p_after_alert_id))
   order by alert.created_at desc, alert.alert_id desc limit p_limit;
end
$$;

create function app_private.mark_tenant_alert_read_v2(
  p_alert_id uuid, p_read_at timestamptz
)
returns table (
  tenant_id uuid, alert_id uuid, subject_id uuid, subject_label text,
  tenant_case_id uuid, case_id uuid, case_event_id uuid,
  cnj_normalized text, tribunal_code text, alert_type text, status text,
  match_status text, source_occurred_at timestamptz,
  created_at timestamptz, read_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  current_tenant_id uuid := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
begin
  if current_user_id is null or current_tenant_id is null
     or p_alert_id is null or p_read_at is null then
    raise exception 'invalid alert read command' using errcode = '22023';
  end if;
  if not exists (select 1 from app_private.tenant_members membership
    where membership.tenant_id=current_tenant_id and membership.user_id=current_user_id
      and membership.active=true) then
    raise exception 'alert membership denied' using errcode = '42501';
  end if;
  update app_private.alerts alert set status='read',
    read_at=coalesce(alert.read_at,p_read_at),
    updated_at=case when alert.read_at is null then p_read_at else alert.updated_at end
   where alert.tenant_id=current_tenant_id and alert.alert_id=p_alert_id
     and alert.case_event_id is not null and p_read_at>=alert.created_at;
  return query
  select alert.tenant_id, alert.alert_id, subject.subject_id, subject.display_label,
         tenant_case.tenant_case_id, case_record.case_id, alert.case_event_id,
         case_record.cnj_normalized, case_record.tribunal_code, alert.alert_type,
         alert.status, alert.match_status, alert.source_occurred_at,
         alert.created_at, alert.read_at
    from app_private.alerts alert
    join app_private.monitored_subjects subject
      on subject.tenant_id=alert.tenant_id and subject.subject_id=alert.subject_id
    join app_private.tenant_cases tenant_case
      on tenant_case.tenant_id=alert.tenant_id and tenant_case.tenant_case_id=alert.tenant_case_id
     and tenant_case.case_id=alert.case_id
    join app_private.case_records case_record
      on case_record.tenant_id=alert.tenant_id and case_record.case_id=alert.case_id
   where alert.tenant_id=current_tenant_id and alert.alert_id=p_alert_id
     and alert.case_event_id is not null;
end
$$;

revoke all on table app_private.case_events, app_private.event_evidence
  from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.complete_monitoring_work_case_evidence(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) from public, app_worker;
revoke all on function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) from public;
revoke all on function app_private.tenant_case_is_visible(uuid)
  from public, app_worker, app_dispatcher;
revoke all on function app_private.list_tenant_case_events(
  uuid, timestamptz, uuid, integer
) from public, app_worker, app_dispatcher;

grant execute on function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) to app_worker;
grant execute on function app_private.tenant_case_is_visible(uuid) to app_runtime;
grant execute on function app_private.list_tenant_case_events(
  uuid, timestamptz, uuid, integer
) to app_runtime;
revoke all on function app_private.project_internal_alerts_without_timeline(
  uuid, uuid, text, uuid, jsonb, timestamptz
) from public, app_dispatcher;
revoke all on function app_private.project_internal_alerts(
  uuid, uuid, text, uuid, jsonb, timestamptz
) from public, app_runtime, app_worker;
revoke all on function app_private.list_tenant_alerts_v2(
  text, timestamptz, uuid, integer
) from public, app_worker, app_dispatcher;
revoke all on function app_private.list_tenant_alerts(
  text, timestamptz, uuid, integer
) from app_runtime;
revoke all on function app_private.mark_tenant_alert_read(
  uuid, timestamptz
) from app_runtime;
revoke all on function app_private.mark_tenant_alert_read_v2(
  uuid, timestamptz
) from public, app_worker, app_dispatcher;
grant execute on function app_private.project_internal_alerts(
  uuid, uuid, text, uuid, jsonb, timestamptz
) to app_dispatcher;
grant execute on function app_private.list_tenant_alerts_v2(
  text, timestamptz, uuid, integer
) to app_runtime;
grant execute on function app_private.mark_tenant_alert_read_v2(
  uuid, timestamptz
) to app_runtime;

reset role;
commit;
