begin;

set role app_migrator;

alter table app_private.monitored_subjects
  add column archived_at timestamptz;

alter table app_private.monitored_subjects
  add constraint monitored_subjects_lifecycle_check
  check (
    (status = 'active' and archived_at is null)
    or (status in ('inactive', 'deleted') and archived_at is not null)
  );

alter table app_private.monitoring_targets
  add column archived_at timestamptz;

alter table app_private.monitoring_targets
  add constraint monitoring_targets_lifecycle_check
  check (
    (status = 'active' and archived_at is null)
    or (status in ('inactive', 'deleted') and archived_at is not null)
  );

create table app_private.sources (
  source_id uuid primary key,
  source_code text not null unique,
  source_name text not null,
  authority text not null,
  status text not null
    check (status in ('active', 'disabled', 'deprecated')),
  terms_version text not null,
  terms_reviewed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (length(source_code) between 2 and 64),
  check (length(source_name) between 2 and 200),
  check (length(authority) between 2 and 200),
  check (length(terms_version) between 2 and 100)
);

insert into app_private.sources (
  source_id,
  source_code,
  source_name,
  authority,
  status,
  terms_version
)
values (
  '40000000-0000-7000-8000-000000000001',
  'djen',
  'Diario de Justica Eletronico Nacional',
  'Conselho Nacional de Justica',
  'disabled',
  'pending-review'
);

create table app_private.target_source_states (
  tenant_id uuid not null,
  state_id uuid not null,
  target_id uuid not null,
  source_id uuid not null references app_private.sources(source_id),
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'ready',
        'running',
        'backoff',
        'disabled',
        'archived'
      )
    ),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_attempt_at timestamptz,
  consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, state_id),
  unique (tenant_id, target_id, source_id),
  foreign key (tenant_id, target_id)
    references app_private.monitoring_targets(tenant_id, target_id),
  check (
    status not in ('ready', 'backoff')
    or next_attempt_at is not null
  )
);

create index target_source_states_source_id_idx
  on app_private.target_source_states(source_id);

create index target_source_states_due_idx
  on app_private.target_source_states(
    tenant_id,
    next_attempt_at,
    state_id
  )
  where status in ('ready', 'backoff');

alter table app_private.target_source_states enable row level security;
alter table app_private.target_source_states force row level security;

create policy target_source_states_current_tenant
  on app_private.target_source_states
  for all to app_runtime
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

grant select on app_private.sources to app_runtime;
grant select, insert, update, delete
  on app_private.target_source_states
  to app_runtime;

reset role;

commit;
