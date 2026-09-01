begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to app_migrator;

set role app_migrator;

alter table app_private.tenant_cases
  add constraint tenant_cases_tenant_case_record_unique
  unique (tenant_id, tenant_case_id, case_id);

create table app_private.alerts (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  alert_id uuid not null default gen_random_uuid(),
  subject_id uuid not null,
  tenant_case_id uuid not null,
  case_id uuid not null,
  source_event_id uuid not null,
  alert_type text not null check (alert_type = 'case_discovered'),
  status text not null default 'unread'
    check (status in ('unread', 'read')),
  match_status text not null default 'unverified'
    check (match_status = 'unverified'),
  source_occurred_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, alert_id),
  foreign key (tenant_id, subject_id)
    references app_private.monitored_subjects(tenant_id, subject_id),
  foreign key (tenant_id, tenant_case_id, case_id)
    references app_private.tenant_cases(tenant_id, tenant_case_id, case_id),
  foreign key (tenant_id, source_event_id)
    references app_private.outbox_events(tenant_id, event_id),
  unique (
    tenant_id, source_event_id, subject_id, tenant_case_id, alert_type
  ),
  check (
    (status = 'unread' and read_at is null)
    or (status = 'read' and read_at is not null and read_at >= created_at)
  ),
  check (updated_at >= created_at)
);

create index alerts_tenant_created_idx
  on app_private.alerts(tenant_id, created_at desc, alert_id desc);

create index alerts_tenant_unread_idx
  on app_private.alerts(tenant_id, created_at desc, alert_id desc)
  where status = 'unread';

create index alerts_subject_fk_idx
  on app_private.alerts(tenant_id, subject_id);

create index alerts_tenant_case_fk_idx
  on app_private.alerts(tenant_id, tenant_case_id, case_id);

alter table app_private.alerts enable row level security;
alter table app_private.alerts force row level security;

create policy alerts_migrator_all
  on app_private.alerts for all to app_migrator
  using (true) with check (true);

create function app_private.project_internal_alerts(
  p_event_id uuid,
  p_tenant_id uuid,
  p_event_type text,
  p_aggregate_id uuid,
  p_payload jsonb,
  p_processed_at timestamptz
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
  if p_event_id is null
     or p_tenant_id is null
     or p_event_type !~ '^[a-z][a-z0-9.]{2,99}\.v[1-9][0-9]*$'
     or p_aggregate_id is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 4096
     or p_processed_at is null then
    raise exception 'invalid internal alert projection' using errcode = '22023';
  end if;

  select item.* into stored_event
    from app_private.outbox_events item
   where item.event_id = p_event_id
   for update;

  if not found
     or stored_event.tenant_id <> p_tenant_id
     or stored_event.event_type <> p_event_type
     or stored_event.aggregate_id <> p_aggregate_id
     or stored_event.payload <> p_payload
     or stored_event.status <> 'pending'
     or stored_event.claimed_by is null
     or p_processed_at < stored_event.last_attempt_at
     or p_processed_at > stored_event.leased_until then
    raise exception 'internal alert event conflict' using errcode = '23505';
  end if;

  expected_hash := extensions.digest(
    convert_to(
      concat_ws(
        E'\x1f', stored_event.event_type, stored_event.aggregate_type,
        stored_event.aggregate_id::text, stored_event.payload::text
      ),
      'UTF8'
    ),
    'sha256'
  );

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
      tenant_id, subject_id, tenant_case_id, case_id, source_event_id,
      alert_type, match_status, source_occurred_at, created_at, updated_at
    )
    select stored_event.tenant_id,
           subject.subject_id,
           tenant_case.tenant_case_id,
           case_record.case_id,
           stored_event.event_id,
           'case_discovered',
           'unverified',
           max(receipt.collected_at),
           p_processed_at,
           p_processed_at
      from app_private.monitoring_executions execution
      join app_private.target_source_states state
        on state.tenant_id = execution.tenant_id
       and state.state_id = execution.state_id
      join app_private.subject_targets link
        on link.tenant_id = state.tenant_id
       and link.target_id = state.target_id
      join app_private.monitored_subjects subject
        on subject.tenant_id = link.tenant_id
       and subject.subject_id = link.subject_id
      join app_private.monitoring_observation_receipts receipt
        on receipt.tenant_id = execution.tenant_id
       and receipt.execution_id = execution.execution_id
      join app_private.source_envelopes envelope
        on envelope.tenant_id = receipt.tenant_id
       and envelope.source_id = state.source_id
       and envelope.external_id = receipt.external_id
       and envelope.content_hash = receipt.content_hash
      join app_private.canonical_observations observation
        on observation.tenant_id = envelope.tenant_id
       and observation.envelope_id = envelope.envelope_id
       and observation.parser_version = receipt.parser_version
      join app_private.case_records case_record
        on case_record.tenant_id = observation.tenant_id
       and case_record.cnj_normalized = observation.cnj_normalized
       and case_record.tribunal_code = observation.tribunal_code
      join app_private.tenant_cases tenant_case
        on tenant_case.tenant_id = case_record.tenant_id
       and tenant_case.case_id = case_record.case_id
       and tenant_case.access_status = 'active'
     where execution.tenant_id = stored_event.tenant_id
       and execution.execution_id = stored_event.aggregate_id
       and execution.status = 'completed'
     group by subject.subject_id,
              tenant_case.tenant_case_id,
              case_record.case_id
    on conflict (
      tenant_id, source_event_id, subject_id, tenant_case_id, alert_type
    ) do nothing;

    get diagnostics projected_count = row_count;
  end if;

  insert into app_private.consumer_inbox_receipts (
    consumer_name, event_id, tenant_id, payload_hash, processed_at
  ) values (
    'internal-alert-projector-v1', p_event_id, p_tenant_id,
    expected_hash, p_processed_at
  );

  return projected_count;
end
$$;

create function app_private.list_tenant_alerts(
  p_status text,
  p_after_created_at timestamptz,
  p_after_alert_id uuid,
  p_limit integer
)
returns table (
  tenant_id uuid,
  alert_id uuid,
  subject_id uuid,
  subject_label text,
  tenant_case_id uuid,
  case_id uuid,
  cnj_normalized text,
  tribunal_code text,
  alert_type text,
  status text,
  match_status text,
  source_occurred_at timestamptz,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_user_id uuid;
  current_tenant_id uuid;
begin
  current_user_id := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  if current_user_id is null
     or current_tenant_id is null
     or p_status not in ('all', 'unread', 'read')
     or p_limit not between 1 and 101
     or ((p_after_created_at is null) <> (p_after_alert_id is null)) then
    raise exception 'invalid alert page' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app_private.tenant_members membership
     where membership.tenant_id = current_tenant_id
       and membership.user_id = current_user_id
       and membership.active = true
  ) then
    raise exception 'alert membership denied' using errcode = '42501';
  end if;

  return query
  select alert.tenant_id,
         alert.alert_id,
         subject.subject_id,
         subject.display_label,
         tenant_case.tenant_case_id,
         case_record.case_id,
         case_record.cnj_normalized,
         case_record.tribunal_code,
         alert.alert_type,
         alert.status,
         alert.match_status,
         alert.source_occurred_at,
         alert.created_at,
         alert.read_at
    from app_private.alerts alert
    join app_private.monitored_subjects subject
      on subject.tenant_id = alert.tenant_id
     and subject.subject_id = alert.subject_id
    join app_private.tenant_cases tenant_case
      on tenant_case.tenant_id = alert.tenant_id
     and tenant_case.tenant_case_id = alert.tenant_case_id
     and tenant_case.case_id = alert.case_id
    join app_private.case_records case_record
      on case_record.tenant_id = alert.tenant_id
     and case_record.case_id = alert.case_id
   where alert.tenant_id = current_tenant_id
     and (p_status = 'all' or alert.status = p_status)
     and (
       p_after_created_at is null
       or (alert.created_at, alert.alert_id)
          < (p_after_created_at, p_after_alert_id)
     )
   order by alert.created_at desc, alert.alert_id desc
   limit p_limit;
end
$$;

create function app_private.mark_tenant_alert_read(
  p_alert_id uuid,
  p_read_at timestamptz
)
returns table (
  tenant_id uuid,
  alert_id uuid,
  subject_id uuid,
  subject_label text,
  tenant_case_id uuid,
  case_id uuid,
  cnj_normalized text,
  tribunal_code text,
  alert_type text,
  status text,
  match_status text,
  source_occurred_at timestamptz,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  current_tenant_id uuid;
begin
  current_user_id := nullif(
    current_setting('app.current_user_id', true), ''
  )::uuid;
  current_tenant_id := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
  if current_user_id is null
     or current_tenant_id is null
     or p_alert_id is null
     or p_read_at is null then
    raise exception 'invalid alert read command' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app_private.tenant_members membership
     where membership.tenant_id = current_tenant_id
       and membership.user_id = current_user_id
       and membership.active = true
  ) then
    raise exception 'alert membership denied' using errcode = '42501';
  end if;

  update app_private.alerts alert
     set status = 'read',
         read_at = coalesce(alert.read_at, p_read_at),
         updated_at = case
           when alert.read_at is null then p_read_at
           else alert.updated_at
         end
   where alert.tenant_id = current_tenant_id
     and alert.alert_id = p_alert_id
     and p_read_at >= alert.created_at;

  return query
  select alert.tenant_id,
         alert.alert_id,
         subject.subject_id,
         subject.display_label,
         tenant_case.tenant_case_id,
         case_record.case_id,
         case_record.cnj_normalized,
         case_record.tribunal_code,
         alert.alert_type,
         alert.status,
         alert.match_status,
         alert.source_occurred_at,
         alert.created_at,
         alert.read_at
    from app_private.alerts alert
    join app_private.monitored_subjects subject
      on subject.tenant_id = alert.tenant_id
     and subject.subject_id = alert.subject_id
    join app_private.tenant_cases tenant_case
      on tenant_case.tenant_id = alert.tenant_id
     and tenant_case.tenant_case_id = alert.tenant_case_id
     and tenant_case.case_id = alert.case_id
    join app_private.case_records case_record
      on case_record.tenant_id = alert.tenant_id
     and case_record.case_id = alert.case_id
   where alert.tenant_id = current_tenant_id
     and alert.alert_id = p_alert_id;
end
$$;

revoke all on table app_private.alerts
  from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.project_internal_alerts(
  uuid, uuid, text, uuid, jsonb, timestamptz
) from public, app_runtime, app_worker;
revoke all on function app_private.list_tenant_alerts(
  text, timestamptz, uuid, integer
) from public, app_worker, app_dispatcher;
revoke all on function app_private.mark_tenant_alert_read(
  uuid, timestamptz
) from public, app_worker, app_dispatcher;

grant execute on function app_private.project_internal_alerts(
  uuid, uuid, text, uuid, jsonb, timestamptz
) to app_dispatcher;
grant execute on function app_private.list_tenant_alerts(
  text, timestamptz, uuid, integer
) to app_runtime;
grant execute on function app_private.mark_tenant_alert_read(
  uuid, timestamptz
) to app_runtime;

reset role;

commit;
