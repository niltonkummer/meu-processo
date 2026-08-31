do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime_local') then
    create role app_runtime_local
      login
      inherit
      password 'local-only-runtime-password'
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end
$$;

grant app_runtime to app_runtime_local;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_worker_local') then
    create role app_worker_local
      login
      inherit
      password 'local-only-worker-password'
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end
$$;

grant app_worker to app_worker_local;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_dispatcher_local') then
    create role app_dispatcher_local
      login
      inherit
      password 'local-only-dispatcher-password'
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end
$$;

grant app_dispatcher to app_dispatcher_local;

do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'app_document_worker_local'
  ) then
    create role app_document_worker_local
      login
      inherit
      password 'local-only-document-worker-password'
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end
$$;

grant app_document_worker to app_document_worker_local;

do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'app_lifecycle_worker_local'
  ) then
    create role app_lifecycle_worker_local
      login
      inherit
      password 'local-only-lifecycle-worker-password'
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end
$$;

grant app_lifecycle_worker to app_lifecycle_worker_local;

insert into app_private.sources (
  source_id,
  source_code,
  source_name,
  authority,
  status,
  terms_version,
  terms_reviewed_at
) values (
  '40000000-0000-7000-8000-000000009999',
  'synthetic-worker',
  'Synthetic local worker source',
  'Meu Processo local tests',
  'active',
  'local-only-v1',
  statement_timestamp()
)
on conflict (source_id) do nothing;
