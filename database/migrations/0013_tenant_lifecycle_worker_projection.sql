begin;

set role app_migrator;

create function app_private.snapshot_claimed_tenant_export(
  p_request_id uuid,
  p_lease_token_hash bytea,
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare claimed record;
declare snapshot jsonb;
begin
  if p_request_id is null or octet_length(p_lease_token_hash) <> 32 or
     p_generated_at is null then
    raise exception 'invalid claimed tenant export snapshot' using errcode='22023';
  end if;

  select request.tenant_id, request.requested_by_user_id,
         tenant.tenant_kind, tenant.created_at,
         member.membership_role, member.created_at as membership_created_at
    into claimed
    from app_private.tenant_data_lifecycle_requests request
    join app_private.tenants tenant on tenant.tenant_id=request.tenant_id
    join app_private.tenant_members member
      on member.tenant_id=request.tenant_id
     and member.user_id=request.requested_by_user_id
   where request.request_id=p_request_id
     and request.request_type='export'
     and request.status='running'
     and request.lease_token_hash=p_lease_token_hash
     and p_generated_at < request.leased_until;
  if not found then return null; end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'generatedAt', p_generated_at,
    'tenant', jsonb_build_object(
      'tenantId', claimed.tenant_id,
      'kind', claimed.tenant_kind,
      'createdAt', claimed.created_at,
      'membershipRole', claimed.membership_role,
      'membershipCreatedAt', claimed.membership_created_at
    ),
    'protectedSubjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subjectId', subject.subject_id,
        'subjectType', subject.subject_type,
        'encryptedValue', subject.encrypted_value,
        'keyVersion', subject.key_version,
        'status', subject.status,
        'createdAt', subject.created_at,
        'archivedAt', subject.archived_at
      ) order by subject.subject_id)
      from app_private.monitored_subjects subject
      where subject.tenant_id=claimed.tenant_id
    ), '[]'::jsonb),
    'monitoringTargets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'targetId', target.target_id,
        'targetType', target.target_type,
        'jurisdiction', target.jurisdiction,
        'status', target.status,
        'nextCheckAt', target.next_check_at,
        'createdAt', target.created_at,
        'valueAvailable', false
      ) order by target.target_id)
      from app_private.monitoring_targets target
      where target.tenant_id=claimed.tenant_id
    ), '[]'::jsonb),
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caseId', record.case_id,
        'cnjNumber', record.cnj_normalized,
        'tribunalCode', record.tribunal_code,
        'identityStatus', record.identity_status,
        'accessStatus', tenant_case.access_status,
        'firstSeenAt', record.first_seen_at,
        'lastProjectedAt', record.last_projected_at,
        'grantedAt', tenant_case.granted_at,
        'revokedAt', tenant_case.revoked_at
      ) order by record.case_id)
      from app_private.case_records record
      left join app_private.tenant_cases tenant_case
        on tenant_case.tenant_id=record.tenant_id
       and tenant_case.case_id=record.case_id
      where record.tenant_id=claimed.tenant_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventId', event.case_event_id,
        'caseId', event.case_id,
        'eventType', event.event_type,
        'occurredAt', event.occurred_at,
        'title', event.title,
        'plainTextExcerpt', event.plain_text_excerpt,
        'projectedAt', event.projected_at
      ) order by event.occurred_at, event.case_event_id)
      from app_private.case_events event
      where event.tenant_id=claimed.tenant_id
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'documentId', document.document_id,
        'caseId', document.case_id,
        'eventId', document.case_event_id,
        'documentType', document.document_type,
        'title', document.title,
        'accessClass', document.access_class,
        'availabilityStatus', document.availability_status,
        'sourceCreatedAt', document.source_created_at,
        'lastVerifiedAt', document.last_verified_at
      ) order by document.source_created_at, document.document_id)
      from app_private.document_records document
      where document.tenant_id=claimed.tenant_id
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alertId', alert.alert_id,
        'subjectId', alert.subject_id,
        'caseId', alert.case_id,
        'eventId', alert.case_event_id,
        'alertType', alert.alert_type,
        'status', alert.status,
        'matchStatus', alert.match_status,
        'sourceOccurredAt', alert.source_occurred_at,
        'readAt', alert.read_at,
        'createdAt', alert.created_at
      ) order by alert.created_at, alert.alert_id)
      from app_private.alerts alert
      where alert.tenant_id=claimed.tenant_id
    ), '[]'::jsonb),
    'operationalSummary', jsonb_build_object(
      'monitoringExecutions', (
        select count(*) from app_private.monitoring_executions execution
        where execution.tenant_id=claimed.tenant_id
      ),
      'outboxEvents', (
        select count(*) from app_private.outbox_events event
        where event.tenant_id=claimed.tenant_id
      ),
      'documentMaterializations', (
        select count(*) from app_private.document_materialization_jobs job
        where job.tenant_id=claimed.tenant_id
      ),
      'documentDownloads', (
        select count(*) from app_private.document_download_outcomes outcome
        where outcome.tenant_id=claimed.tenant_id
      )
    ),
    'omitted', jsonb_build_array(jsonb_build_object(
      'dataClass', 'monitoring_target_plaintext',
      'reason', 'not_recoverable_from_current_target_schema'
    ))
  ) into snapshot;

  if pg_column_size(snapshot) > 10485760 then
    raise exception 'tenant export snapshot exceeds limit' using errcode='54000';
  end if;
  return snapshot;
end
$$;

create function app_private.list_claimed_tenant_object_ids(
  p_request_id uuid,
  p_lease_token_hash bytea,
  p_now timestamptz
)
returns table (storage_object_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare claimed_tenant_id uuid;
begin
  if p_request_id is null or octet_length(p_lease_token_hash) <> 32 or
     p_now is null then
    raise exception 'invalid claimed tenant object inventory' using errcode='22023';
  end if;
  select request.tenant_id into claimed_tenant_id
    from app_private.tenant_data_lifecycle_requests request
   where request.request_id=p_request_id
     and request.request_type='deletion'
     and request.status='running'
     and request.lease_token_hash=p_lease_token_hash
     and p_now < request.leased_until;
  if not found then return; end if;

  return query
  select inventory.storage_object_id
    from (
      select artifact.storage_object_id
        from app_private.document_artifacts artifact
       where artifact.tenant_id=claimed_tenant_id
         and artifact.deleted_at is null
      union
      select request.artifact_object_id
        from app_private.tenant_data_lifecycle_requests request
       where request.tenant_id=claimed_tenant_id
         and request.request_type='export'
         and request.status in ('completed', 'expired')
         and request.artifact_object_id is not null
    ) inventory
   order by inventory.storage_object_id;
end
$$;

create function app_private.list_due_tenant_export_expirations(
  p_now timestamptz,
  p_limit integer
)
returns table (
  request_id uuid,
  tenant_id uuid,
  storage_object_id text,
  content_hash text,
  size_bytes bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null or p_limit not between 1 and 10 then
    raise exception 'invalid tenant export expiration page' using errcode='22023';
  end if;
  return query
  select request.request_id, request.tenant_id, request.artifact_object_id,
         request.artifact_sha256, request.artifact_size_bytes
    from app_private.tenant_data_lifecycle_requests request
   where request.request_type='export'
     and request.status='completed'
     and request.artifact_expires_at <= p_now
   order by request.artifact_expires_at, request.request_id
   limit p_limit;
end
$$;

revoke all on function app_private.snapshot_claimed_tenant_export(
  uuid, bytea, timestamptz
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.list_claimed_tenant_object_ids(
  uuid, bytea, timestamptz
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;
revoke all on function app_private.list_due_tenant_export_expirations(
  timestamptz, integer
) from public, app_runtime, app_worker, app_dispatcher, app_document_worker;

grant execute on function app_private.snapshot_claimed_tenant_export(
  uuid, bytea, timestamptz
) to app_lifecycle_worker;
grant execute on function app_private.list_claimed_tenant_object_ids(
  uuid, bytea, timestamptz
) to app_lifecycle_worker;
grant execute on function app_private.list_due_tenant_export_expirations(
  timestamptz, integer
) to app_lifecycle_worker;

reset role;
commit;
