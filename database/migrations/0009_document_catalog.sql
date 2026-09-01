begin;

set role app_migrator;

alter table app_private.case_events
  add constraint case_events_tenant_case_event_unique
  unique (tenant_id, case_id, case_event_id);

alter table app_private.source_envelopes
  add constraint source_envelopes_tenant_envelope_source_unique
  unique (tenant_id, envelope_id, source_id);

create table app_private.document_records (
  tenant_id uuid not null,
  document_id uuid not null,
  case_id uuid not null,
  case_event_id uuid,
  source_id uuid not null references app_private.sources(source_id),
  envelope_id uuid not null,
  external_document_id text not null
    check (length(external_document_id) between 1 and 255
      and external_document_id !~ '[[:cntrl:]]'),
  document_type text check (
    document_type ~ '^[a-z][a-z0-9_.-]{1,63}$'
  ),
  title text not null check (
    length(title) between 1 and 200 and title !~ '[[:cntrl:]]'
  ),
  access_class text not null check (
    access_class in ('public_official', 'restricted', 'unknown')
  ),
  availability_status text not null check (
    availability_status in ('metadata_only', 'available', 'expired', 'unavailable')
  ),
  expected_media_type text not null default 'application/pdf'
    check (expected_media_type = 'application/pdf'),
  source_created_at timestamptz not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, document_id),
  unique (tenant_id, source_id, external_document_id),
  foreign key (tenant_id, case_id)
    references app_private.case_records(tenant_id, case_id),
  foreign key (tenant_id, case_id, case_event_id)
    references app_private.case_events(tenant_id, case_id, case_event_id),
  foreign key (tenant_id, envelope_id, source_id)
    references app_private.source_envelopes(tenant_id, envelope_id, source_id),
  check (last_verified_at >= source_created_at)
);

create index document_records_case_page_idx
  on app_private.document_records(
    tenant_id, case_id, source_created_at desc, document_id desc
  );
create index document_records_event_fk_idx
  on app_private.document_records(tenant_id, case_id, case_event_id)
  where case_event_id is not null;
create index document_records_envelope_fk_idx
  on app_private.document_records(tenant_id, envelope_id, source_id);

create table app_private.document_artifacts (
  tenant_id uuid not null,
  artifact_id uuid not null,
  document_id uuid not null,
  scope_kind text not null check (scope_kind = 'tenant_private'),
  storage_object_id text not null,
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  media_type text not null check (media_type = 'application/pdf'),
  size_bytes integer not null check (size_bytes between 1 and 104857600),
  malware_scan_status text not null check (
    malware_scan_status in ('pending', 'clean', 'infected', 'failed')
  ),
  encryption_key_version text not null check (
    encryption_key_version ~ '^v[1-9][0-9]{0,8}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  primary key (tenant_id, artifact_id),
  unique (tenant_id, document_id, content_hash),
  foreign key (tenant_id, document_id)
    references app_private.document_records(tenant_id, document_id),
  check (
    storage_object_id like
      'documents/tenant/' || tenant_id::text || '/%'
    and storage_object_id !~ '://'
    and storage_object_id !~ '[[:cntrl:]]'
    and length(storage_object_id) between 64 and 512
  ),
  check (expires_at > created_at),
  check (deleted_at is null or deleted_at >= created_at)
);

create index document_artifacts_document_ready_idx
  on app_private.document_artifacts(
    tenant_id, document_id, created_at desc, artifact_id desc
  ) where malware_scan_status = 'clean' and deleted_at is null;
create index document_artifacts_expiry_idx
  on app_private.document_artifacts(expires_at)
  where deleted_at is null;

alter table app_private.document_records enable row level security;
alter table app_private.document_records force row level security;
alter table app_private.document_artifacts enable row level security;
alter table app_private.document_artifacts force row level security;

create policy document_migrator_records
  on app_private.document_records for all to app_migrator
  using (true) with check (true);
create policy document_migrator_artifacts
  on app_private.document_artifacts for all to app_migrator
  using (true) with check (true);

create function app_private.list_tenant_case_documents(
  p_case_id uuid,
  p_after_source_created_at timestamptz,
  p_after_document_id uuid,
  p_limit integer
)
returns table (
  tenant_id uuid, document_id uuid, case_id uuid, case_event_id uuid,
  title text, document_type text, access_class text,
  availability_status text, expected_media_type text,
  source_created_at timestamptz, last_verified_at timestamptz,
  source_code text, source_official boolean,
  artifact_id uuid, artifact_media_type text, artifact_size_bytes integer,
  artifact_content_hash text, artifact_expires_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_tenant_id uuid := nullif(
    current_setting('app.current_tenant_id', true), ''
  )::uuid;
begin
  if p_limit not between 1 and 101
     or ((p_after_source_created_at is null) <>
         (p_after_document_id is null)) then
    raise exception 'invalid case document page' using errcode = '22023';
  end if;
  if not app_private.tenant_case_is_visible(p_case_id) then
    return;
  end if;

  return query
  select record.tenant_id, record.document_id, record.case_id,
         record.case_event_id, record.title, record.document_type,
         record.access_class, record.availability_status,
         record.expected_media_type, record.source_created_at,
         record.last_verified_at, source.source_code,
         source.source_class = 'official', artifact.artifact_id,
         artifact.media_type, artifact.size_bytes, artifact.content_hash,
         artifact.expires_at
    from app_private.document_records record
    join app_private.sources source on source.source_id = record.source_id
    left join lateral (
      select candidate.artifact_id, candidate.media_type,
             candidate.size_bytes, candidate.content_hash,
             candidate.expires_at
        from app_private.document_artifacts candidate
       where candidate.tenant_id = record.tenant_id
         and candidate.document_id = record.document_id
         and candidate.malware_scan_status = 'clean'
         and candidate.deleted_at is null
         and candidate.expires_at > statement_timestamp()
       order by candidate.created_at desc, candidate.artifact_id desc
       limit 1
    ) artifact on true
   where record.tenant_id = current_tenant_id
     and record.case_id = p_case_id
     and (p_after_source_created_at is null or
          (record.source_created_at, record.document_id) <
          (p_after_source_created_at, p_after_document_id))
   order by record.source_created_at desc, record.document_id desc
   limit p_limit;
end
$$;

revoke all on table app_private.document_records,
  app_private.document_artifacts
  from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.list_tenant_case_documents(
  uuid, timestamptz, uuid, integer
) from public, app_worker, app_dispatcher;
grant execute on function app_private.list_tenant_case_documents(
  uuid, timestamptz, uuid, integer
) to app_runtime;

reset role;
commit;
