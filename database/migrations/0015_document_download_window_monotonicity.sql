begin;
set role app_migrator;

create function app_private.enforce_monotonic_download_window_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(old.updated_at, new.updated_at);
  return new;
end
$$;

create trigger document_download_windows_monotonic_timestamp
before update on app_private.document_download_windows
for each row execute function
  app_private.enforce_monotonic_download_window_timestamp();

revoke all on function
  app_private.enforce_monotonic_download_window_timestamp()
  from public, app_runtime, app_worker, app_dispatcher,
    app_document_worker, app_lifecycle_worker;

reset role;
commit;
