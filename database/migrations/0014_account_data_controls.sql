begin;
set role app_migrator;

create function app_private.get_tenant_data_lifecycle_request(
  p_request_id uuid
)
returns table (
  request_id uuid,
  request_type text,
  state text,
  requested_at timestamptz,
  completed_at timestamptz,
  artifact_size_bytes bigint,
  artifact_expires_at timestamptz,
  artifact_object_id text,
  artifact_sha256 text
)
language sql
security definer
set search_path = ''
stable
as $$
  select item.request_id, item.request_type, item.status, item.requested_at,
    item.completed_at, item.artifact_size_bytes, item.artifact_expires_at,
    item.artifact_object_id, item.artifact_sha256
  from app_private.tenant_data_lifecycle_requests item
  join app_private.tenants tenant on tenant.tenant_id=item.tenant_id
  join app_private.tenant_members member
    on member.tenant_id=item.tenant_id
   and member.user_id=nullif(
     current_setting('app.current_user_id', true), ''
   )::uuid
   and member.active=true
  where p_request_id is not null
    and item.request_id=p_request_id
    and item.tenant_id=nullif(
      current_setting('app.current_tenant_id', true), ''
    )::uuid
    and tenant.status='active'
$$;

revoke all on function app_private.get_tenant_data_lifecycle_request(uuid)
  from public, app_worker, app_dispatcher, app_document_worker,
    app_lifecycle_worker;
grant execute on function app_private.get_tenant_data_lifecycle_request(uuid)
  to app_runtime;

reset role;
commit;
