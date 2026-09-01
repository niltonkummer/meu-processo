begin;

set role app_migrator;

alter table app_private.document_records
  add constraint document_records_tenant_case_document_unique
  unique (tenant_id, case_id, document_id);

alter table app_private.document_artifacts
  add constraint document_artifacts_tenant_document_artifact_unique
  unique (tenant_id, document_id, artifact_id);

create table app_private.document_download_windows (
  tenant_id uuid not null,
  user_id uuid not null,
  window_started_at timestamptz not null,
  consumed integer not null check (consumed between 1 and 100),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, user_id, window_started_at),
  foreign key (tenant_id, user_id)
    references app_private.tenant_members(tenant_id, user_id),
  check (window_started_at = date_trunc('minute', window_started_at)),
  check (updated_at >= created_at)
);

create table app_private.document_download_authorizations (
  tenant_id uuid not null,
  authorization_id uuid not null,
  user_id uuid not null,
  case_id uuid not null,
  document_id uuid not null,
  artifact_id uuid not null,
  request_id uuid not null,
  authorized_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  primary key (tenant_id, authorization_id),
  unique (tenant_id, request_id),
  foreign key (tenant_id, user_id)
    references app_private.tenant_members(tenant_id, user_id),
  foreign key (tenant_id, case_id, document_id)
    references app_private.document_records(tenant_id, case_id, document_id),
  foreign key (tenant_id, document_id, artifact_id)
    references app_private.document_artifacts(tenant_id, document_id, artifact_id),
  check (expires_at > authorized_at and
         expires_at <= authorized_at + interval '10 minutes')
);

create index document_download_authorizations_user_time_idx
  on app_private.document_download_authorizations(
    tenant_id, user_id, authorized_at desc, authorization_id desc
  );
create index document_download_authorizations_case_fk_idx
  on app_private.document_download_authorizations(
    tenant_id, case_id, document_id
  );
create index document_download_authorizations_artifact_fk_idx
  on app_private.document_download_authorizations(
    tenant_id, document_id, artifact_id
  );

create table app_private.document_download_outcomes (
  tenant_id uuid not null,
  authorization_id uuid not null,
  outcome text not null check (
    outcome in ('delivered', 'object_missing', 'integrity_failed', 'storage_failed')
  ),
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, authorization_id),
  foreign key (tenant_id, authorization_id)
    references app_private.document_download_authorizations(
      tenant_id, authorization_id
    )
);

alter table app_private.document_download_windows enable row level security;
alter table app_private.document_download_windows force row level security;
alter table app_private.document_download_authorizations enable row level security;
alter table app_private.document_download_authorizations force row level security;
alter table app_private.document_download_outcomes enable row level security;
alter table app_private.document_download_outcomes force row level security;

create policy document_delivery_migrator_windows
  on app_private.document_download_windows for all to app_migrator
  using (true) with check (true);
create policy document_delivery_migrator_authorizations
  on app_private.document_download_authorizations for all to app_migrator
  using (true) with check (true);
create policy document_delivery_migrator_outcomes
  on app_private.document_download_outcomes for all to app_migrator
  using (true) with check (true);

create function app_private.authorize_tenant_document_download(
  p_case_id uuid,
  p_document_id uuid,
  p_authorization_id uuid,
  p_request_id uuid,
  p_quota_per_minute integer
)
returns table (
  result_status text,
  authorization_id uuid,
  tenant_id uuid,
  user_id uuid,
  case_id uuid,
  document_id uuid,
  artifact_id uuid,
  storage_object_id text,
  title text,
  media_type text,
  size_bytes integer,
  content_hash text
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
  current_window timestamptz := date_trunc('minute', statement_timestamp());
  current_consumed integer;
  selected_record record;
begin
  if p_case_id is null or p_document_id is null or
     p_authorization_id is null or p_request_id is null or
     p_quota_per_minute not between 1 and 100 then
    raise exception 'invalid document delivery authorization'
      using errcode = '22023';
  end if;
  if not app_private.tenant_case_is_visible(p_case_id) then
    result_status := 'not_found';
    return next;
    return;
  end if;

  select document.title, artifact.artifact_id, artifact.storage_object_id,
         artifact.media_type, artifact.size_bytes, artifact.content_hash
    into selected_record
    from app_private.document_records document
    join app_private.document_artifacts artifact
      on artifact.tenant_id = document.tenant_id
     and artifact.document_id = document.document_id
   where document.tenant_id = current_tenant_id
     and document.case_id = p_case_id
     and document.document_id = p_document_id
     and document.access_class = 'public_official'
     and document.availability_status = 'available'
     and artifact.malware_scan_status = 'clean'
     and artifact.deleted_at is null
     and artifact.expires_at > statement_timestamp()
   order by artifact.created_at desc, artifact.artifact_id desc
   limit 1;
  if not found then
    result_status := 'not_found';
    return next;
    return;
  end if;

  insert into app_private.document_download_windows as usage_window (
    tenant_id, user_id, window_started_at, consumed
  ) values (
    current_tenant_id, current_user_id, current_window, 1
  )
  on conflict on constraint document_download_windows_pkey do update
     set consumed = usage_window.consumed + 1,
         updated_at = statement_timestamp()
   where usage_window.consumed < p_quota_per_minute
  returning consumed into current_consumed;
  if current_consumed is null then
    result_status := 'quota_exceeded';
    return next;
    return;
  end if;

  insert into app_private.document_download_authorizations (
    tenant_id, authorization_id, user_id, case_id, document_id,
    artifact_id, request_id, expires_at
  ) values (
    current_tenant_id, p_authorization_id, current_user_id, p_case_id,
    p_document_id, selected_record.artifact_id, p_request_id,
    statement_timestamp() + interval '5 minutes'
  );

  result_status := 'authorized';
  authorization_id := p_authorization_id;
  tenant_id := current_tenant_id;
  user_id := current_user_id;
  case_id := p_case_id;
  document_id := p_document_id;
  artifact_id := selected_record.artifact_id;
  storage_object_id := selected_record.storage_object_id;
  title := selected_record.title;
  media_type := selected_record.media_type;
  size_bytes := selected_record.size_bytes;
  content_hash := selected_record.content_hash;
  return next;
end
$$;

create function app_private.record_document_download_outcome(
  p_authorization_id uuid,
  p_outcome text
)
returns boolean
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
begin
  if p_authorization_id is null or p_outcome not in (
    'delivered', 'object_missing', 'integrity_failed', 'storage_failed'
  ) then
    raise exception 'invalid document delivery outcome' using errcode = '22023';
  end if;
  insert into app_private.document_download_outcomes (
    tenant_id, authorization_id, outcome
  )
  select authorized.tenant_id, authorized.authorization_id, p_outcome
    from app_private.document_download_authorizations authorized
   where authorized.tenant_id = current_tenant_id
     and authorized.user_id = current_user_id
     and authorized.authorization_id = p_authorization_id
  on conflict (tenant_id, authorization_id) do nothing;
  return found;
end
$$;

revoke all on table app_private.document_download_windows,
  app_private.document_download_authorizations,
  app_private.document_download_outcomes
  from public, app_runtime, app_worker, app_dispatcher;
revoke all on function app_private.authorize_tenant_document_download(
  uuid, uuid, uuid, uuid, integer
) from public, app_worker, app_dispatcher;
revoke all on function app_private.record_document_download_outcome(
  uuid, text
) from public, app_worker, app_dispatcher;
grant execute on function app_private.authorize_tenant_document_download(
  uuid, uuid, uuid, uuid, integer
) to app_runtime;
grant execute on function app_private.record_document_download_outcome(
  uuid, text
) to app_runtime;

reset role;
commit;
