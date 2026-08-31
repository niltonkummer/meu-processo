begin;

revoke create on schema public from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_migrator') then
    create role app_migrator
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end
$$;

create schema app_private authorization app_migrator;
create schema app_public authorization app_migrator;

revoke all on schema app_private from public;
revoke all on schema app_public from public;
grant usage on schema app_private to app_runtime;
grant usage on schema app_public to app_runtime;

set role app_migrator;

create function app_private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create function app_private.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.current_tenant_id', true), '')::uuid
$$;

create table app_private.user_accounts (
  user_id uuid primary key,
  provider_subject text not null unique,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deleted')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (length(provider_subject) between 1 and 255)
);

create table app_private.tenants (
  tenant_id uuid primary key,
  tenant_kind text not null check (tenant_kind in ('personal', 'organization')),
  personal_owner_user_id uuid references app_private.user_accounts(user_id),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deleting', 'deleted')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    (tenant_kind = 'personal' and personal_owner_user_id is not null)
    or (tenant_kind = 'organization' and personal_owner_user_id is null)
  )
);

create unique index tenants_personal_owner_uidx
  on app_private.tenants(personal_owner_user_id)
  where tenant_kind = 'personal' and status <> 'deleted';

create table app_private.tenant_members (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  user_id uuid not null references app_private.user_accounts(user_id),
  membership_role text not null
    check (membership_role in ('owner', 'admin', 'lawyer', 'viewer')),
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, user_id)
);

create index tenant_members_user_id_idx
  on app_private.tenant_members(user_id, tenant_id);

create table app_private.monitored_subjects (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  subject_id uuid not null,
  subject_type text not null check (subject_type in ('name', 'cpf', 'cnpj')),
  display_label text not null check (length(display_label) between 1 and 200),
  protected_reference text not null
    check (length(protected_reference) between 16 and 512),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'deleted')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, subject_id),
  unique (tenant_id, subject_type, protected_reference)
);

create table app_private.monitoring_targets (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  target_id uuid not null,
  target_type text not null check (target_type in ('name', 'cpf', 'cnpj', 'cnj', 'oab')),
  display_label text not null check (length(display_label) between 1 and 200),
  protected_reference text not null
    check (length(protected_reference) between 16 and 512),
  jurisdiction text not null default 'BR'
    check (length(jurisdiction) between 2 and 32),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'deleted')),
  next_check_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, target_id),
  unique (tenant_id, target_type, protected_reference, jurisdiction)
);

create index monitoring_targets_due_idx
  on app_private.monitoring_targets(tenant_id, next_check_at, target_id)
  where status = 'active';

create table app_private.subject_targets (
  tenant_id uuid not null,
  subject_id uuid not null,
  target_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, subject_id, target_id),
  foreign key (tenant_id, subject_id)
    references app_private.monitored_subjects(tenant_id, subject_id),
  foreign key (tenant_id, target_id)
    references app_private.monitoring_targets(tenant_id, target_id)
);

create index subject_targets_target_id_idx
  on app_private.subject_targets(tenant_id, target_id, subject_id);

alter table app_private.user_accounts enable row level security;
alter table app_private.user_accounts force row level security;
alter table app_private.tenants enable row level security;
alter table app_private.tenants force row level security;
alter table app_private.tenant_members enable row level security;
alter table app_private.tenant_members force row level security;
alter table app_private.monitored_subjects enable row level security;
alter table app_private.monitored_subjects force row level security;
alter table app_private.monitoring_targets enable row level security;
alter table app_private.monitoring_targets force row level security;
alter table app_private.subject_targets enable row level security;
alter table app_private.subject_targets force row level security;

create policy user_accounts_current_user on app_private.user_accounts
  for all to app_runtime
  using (user_id = (select app_private.current_user_id()))
  with check (user_id = (select app_private.current_user_id()));

create policy tenants_current_tenant on app_private.tenants
  for all to app_runtime
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

create policy tenant_members_current_tenant on app_private.tenant_members
  for all to app_runtime
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

create policy monitored_subjects_current_tenant on app_private.monitored_subjects
  for all to app_runtime
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

create policy monitoring_targets_current_tenant on app_private.monitoring_targets
  for all to app_runtime
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

create policy subject_targets_current_tenant on app_private.subject_targets
  for all to app_runtime
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

reset role;

grant execute on function app_private.current_user_id() to app_runtime;
grant execute on function app_private.current_tenant_id() to app_runtime;
grant select, insert, update, delete on
  app_private.user_accounts,
  app_private.tenants,
  app_private.tenant_members,
  app_private.monitored_subjects,
  app_private.monitoring_targets,
  app_private.subject_targets
to app_runtime;

commit;
