begin;

set role app_migrator;

alter table app_private.sources
  add column source_class text not null default 'synthetic'
  check (source_class in ('official', 'synthetic'));

update app_private.sources
   set source_class = 'official'
 where source_code = 'djen';

create table app_private.source_envelopes (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  envelope_id uuid not null,
  source_id uuid not null references app_private.sources(source_id),
  visibility text not null default 'tenant_private'
    check (visibility = 'tenant_private'),
  external_id text not null check (length(external_id) between 1 and 255),
  content_hash text not null
    check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  retrieved_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, envelope_id),
  unique (tenant_id, source_id, external_id, content_hash)
);

create table app_private.canonical_observations (
  tenant_id uuid not null,
  observation_id uuid not null,
  envelope_id uuid not null,
  schema_version smallint not null check (schema_version = 1),
  parser_version text not null check (length(parser_version) between 1 and 100),
  cnj_normalized text not null check (
    cnj_normalized ~ '^[0-9]{7}-[0-9]{2}[.][0-9]{4}[.][0-9][.][0-9]{2}[.][0-9]{4}$'
  ),
  tribunal_code text not null check (
    tribunal_code ~ '^[A-Z][A-Z0-9-]{1,19}$'
  ),
  collected_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, observation_id),
  unique (tenant_id, envelope_id, parser_version, schema_version),
  foreign key (tenant_id, envelope_id)
    references app_private.source_envelopes(tenant_id, envelope_id)
);

create table app_private.case_records (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  case_id uuid not null,
  cnj_normalized text not null check (
    cnj_normalized ~ '^[0-9]{7}-[0-9]{2}[.][0-9]{4}[.][0-9][.][0-9]{2}[.][0-9]{4}$'
  ),
  identity_status text not null default 'confirmed'
    check (identity_status = 'confirmed'),
  tribunal_code text not null check (
    tribunal_code ~ '^[A-Z][A-Z0-9-]{1,19}$'
  ),
  projection_version integer not null default 1 check (projection_version = 1),
  first_seen_at timestamptz not null,
  last_projected_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, case_id),
  unique (tenant_id, cnj_normalized),
  check (last_projected_at >= first_seen_at)
);

create table app_private.case_external_references (
  tenant_id uuid not null,
  external_reference_id uuid not null,
  case_id uuid not null,
  source_id uuid not null references app_private.sources(source_id),
  external_case_id text not null check (length(external_case_id) between 1 and 255),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, external_reference_id),
  unique (tenant_id, source_id, external_case_id),
  foreign key (tenant_id, case_id)
    references app_private.case_records(tenant_id, case_id),
  check (last_seen_at >= first_seen_at)
);

create index case_external_references_case_idx
  on app_private.case_external_references(tenant_id, case_id);

create table app_private.tenant_cases (
  tenant_id uuid not null references app_private.tenants(tenant_id),
  tenant_case_id uuid not null,
  case_id uuid not null,
  access_status text not null default 'active'
    check (access_status in ('active', 'revoked')),
  projection_version integer not null default 1 check (projection_version = 1),
  granted_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (tenant_id, tenant_case_id),
  unique (tenant_id, case_id),
  foreign key (tenant_id, case_id)
    references app_private.case_records(tenant_id, case_id),
  check (
    (access_status = 'active' and revoked_at is null)
    or (access_status = 'revoked' and revoked_at is not null)
  )
);

alter table app_private.source_envelopes enable row level security;
alter table app_private.source_envelopes force row level security;
alter table app_private.canonical_observations enable row level security;
alter table app_private.canonical_observations force row level security;
alter table app_private.case_records enable row level security;
alter table app_private.case_records force row level security;
alter table app_private.case_external_references enable row level security;
alter table app_private.case_external_references force row level security;
alter table app_private.tenant_cases enable row level security;
alter table app_private.tenant_cases force row level security;

create policy evidence_migrator_envelopes
  on app_private.source_envelopes for all to app_migrator
  using (true) with check (true);
create policy evidence_migrator_observations
  on app_private.canonical_observations for all to app_migrator
  using (true) with check (true);
create policy evidence_migrator_cases
  on app_private.case_records for all to app_migrator
  using (true) with check (true);
create policy evidence_migrator_external_references
  on app_private.case_external_references for all to app_migrator
  using (true) with check (true);
create policy evidence_migrator_tenant_cases
  on app_private.tenant_cases for all to app_migrator
  using (true) with check (true);

create function app_private.list_tenant_case_summaries(
  p_after_case_id uuid,
  p_limit integer
)
returns table (
  tenant_id uuid,
  case_id uuid,
  cnj_normalized text,
  tribunal_code text,
  identity_status text,
  last_projected_at timestamptz,
  sources jsonb
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
     or p_limit not between 1 and 101 then
    raise exception 'invalid case portfolio request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app_private.tenant_members membership
     where membership.tenant_id = current_tenant_id
       and membership.user_id = current_user_id
       and membership.active = true
  ) then
    raise exception 'case portfolio membership denied' using errcode = '42501';
  end if;

  return query
  select record.tenant_id,
         record.case_id,
         record.cnj_normalized,
         record.tribunal_code,
         record.identity_status,
         record.last_projected_at,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'sourceId', source.source_code,
               'official', source.source_class = 'official',
               'collectedAt', reference.last_seen_at
             ) order by source.source_code
           ) filter (where source.source_id is not null),
           '[]'::jsonb
         ) as sources
    from app_private.tenant_cases tenant_case
    join app_private.case_records record
      on record.tenant_id = tenant_case.tenant_id
     and record.case_id = tenant_case.case_id
    left join app_private.case_external_references reference
      on reference.tenant_id = record.tenant_id
     and reference.case_id = record.case_id
    left join app_private.sources source
      on source.source_id = reference.source_id
   where tenant_case.tenant_id = current_tenant_id
     and tenant_case.access_status = 'active'
     and (p_after_case_id is null or record.case_id > p_after_case_id)
   group by record.tenant_id,
            record.case_id,
            record.cnj_normalized,
            record.tribunal_code,
            record.identity_status,
            record.last_projected_at
   order by record.case_id
   limit p_limit;
end
$$;

revoke all on function app_private.list_tenant_case_summaries(
  uuid, integer
) from public;
grant execute on function app_private.list_tenant_case_summaries(
  uuid, integer
) to app_runtime;

alter function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) rename to complete_monitoring_work_receipts;

revoke all on function app_private.complete_monitoring_work_receipts(
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
  execution record;
  evidence_item jsonb;
  receipt_items jsonb;
  resolved_envelope_id uuid;
  resolved_case_id uuid;
  accepted boolean;
begin
  if p_execution_id is null
     or octet_length(p_lease_token_hash) <> 32
     or p_completed_at is null
     or p_next_attempt_at <= p_completed_at
     or jsonb_typeof(p_evidence) <> 'array'
     or jsonb_array_length(p_evidence) > 1000
     or octet_length(p_outcome_fingerprint) <> 32
     or p_event_id is null then
    raise exception 'invalid evidence completion' using errcode = '22023';
  end if;

  select item.*,
         state.source_id
    into execution
    from app_private.monitoring_executions item
    join app_private.target_source_states state
      on state.tenant_id = item.tenant_id
     and state.state_id = item.state_id
   where item.execution_id = p_execution_id
   for update of item, state;

  if not found or execution.lease_token_hash <> p_lease_token_hash then
    return false;
  end if;
  if execution.status = 'completed' then
    return execution.outcome_fingerprint = p_outcome_fingerprint;
  end if;
  if execution.status <> 'running'
     or p_completed_at >= execution.leased_until then
    return false;
  end if;

  for evidence_item in select value from jsonb_array_elements(p_evidence)
  loop
    if jsonb_typeof(evidence_item) <> 'object'
       or (select count(*) from jsonb_object_keys(evidence_item)) <> 12
       or not evidence_item ?& array[
         'externalId', 'contentHash', 'parserVersion', 'schemaVersion',
         'cnjNumber', 'tribunalCode', 'collectedAt', 'envelopeId',
         'observationId', 'caseId', 'externalReferenceId', 'tenantCaseId'
       ]
       or length(evidence_item->>'externalId') not between 1 and 255
       or (evidence_item->>'contentHash') !~ '^sha256:[a-f0-9]{64}$'
       or length(evidence_item->>'parserVersion') not between 1 and 100
       or jsonb_typeof(evidence_item->'schemaVersion') <> 'number'
       or (evidence_item->>'schemaVersion') <> '1'
       or (evidence_item->>'cnjNumber')
         !~ '^[0-9]{7}-[0-9]{2}[.][0-9]{4}[.][0-9][.][0-9]{2}[.][0-9]{4}$'
       or (evidence_item->>'tribunalCode') !~ '^[A-Z][A-Z0-9-]{1,19}$'
       or (evidence_item->>'envelopeId')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (evidence_item->>'observationId')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (evidence_item->>'caseId')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (evidence_item->>'externalReferenceId')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (evidence_item->>'tenantCaseId')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid canonical evidence' using errcode = '22023';
    end if;

    insert into app_private.source_envelopes (
      tenant_id, envelope_id, source_id, external_id, content_hash, retrieved_at
    ) values (
      execution.tenant_id,
      (evidence_item->>'envelopeId')::uuid,
      execution.source_id,
      evidence_item->>'externalId',
      evidence_item->>'contentHash',
      (evidence_item->>'collectedAt')::timestamptz
    )
    on conflict (tenant_id, source_id, external_id, content_hash) do nothing;

    select envelope.envelope_id
      into resolved_envelope_id
      from app_private.source_envelopes envelope
     where envelope.tenant_id = execution.tenant_id
       and envelope.source_id = execution.source_id
       and envelope.external_id = evidence_item->>'externalId'
       and envelope.content_hash = evidence_item->>'contentHash';

    insert into app_private.canonical_observations (
      tenant_id, observation_id, envelope_id, schema_version, parser_version,
      cnj_normalized, tribunal_code, collected_at
    ) values (
      execution.tenant_id,
      (evidence_item->>'observationId')::uuid,
      resolved_envelope_id,
      1,
      evidence_item->>'parserVersion',
      evidence_item->>'cnjNumber',
      evidence_item->>'tribunalCode',
      (evidence_item->>'collectedAt')::timestamptz
    )
    on conflict (tenant_id, envelope_id, parser_version, schema_version)
    do nothing;

    if not exists (
      select 1 from app_private.canonical_observations observation
       where observation.tenant_id = execution.tenant_id
         and observation.envelope_id = resolved_envelope_id
         and observation.parser_version = evidence_item->>'parserVersion'
         and observation.schema_version = 1
         and observation.cnj_normalized = evidence_item->>'cnjNumber'
         and observation.tribunal_code = evidence_item->>'tribunalCode'
    ) then
      raise exception 'canonical observation conflict' using errcode = '23505';
    end if;

    insert into app_private.case_records (
      tenant_id, case_id, cnj_normalized, tribunal_code,
      first_seen_at, last_projected_at
    ) values (
      execution.tenant_id,
      (evidence_item->>'caseId')::uuid,
      evidence_item->>'cnjNumber',
      evidence_item->>'tribunalCode',
      (evidence_item->>'collectedAt')::timestamptz,
      p_completed_at
    )
    on conflict (tenant_id, cnj_normalized) do update
      set first_seen_at = least(
            app_private.case_records.first_seen_at,
            excluded.first_seen_at
          ),
          last_projected_at = greatest(
            app_private.case_records.last_projected_at,
            excluded.last_projected_at
          ),
          updated_at = greatest(
            app_private.case_records.updated_at,
            excluded.last_projected_at
          );

    select record.case_id
      into resolved_case_id
      from app_private.case_records record
     where record.tenant_id = execution.tenant_id
       and record.cnj_normalized = evidence_item->>'cnjNumber'
       and record.tribunal_code = evidence_item->>'tribunalCode';
    if not found then
      raise exception 'case projection conflict' using errcode = '23505';
    end if;

    insert into app_private.case_external_references (
      tenant_id, external_reference_id, case_id, source_id, external_case_id,
      first_seen_at, last_seen_at
    ) values (
      execution.tenant_id,
      (evidence_item->>'externalReferenceId')::uuid,
      resolved_case_id,
      execution.source_id,
      evidence_item->>'cnjNumber',
      (evidence_item->>'collectedAt')::timestamptz,
      (evidence_item->>'collectedAt')::timestamptz
    )
    on conflict (tenant_id, source_id, external_case_id) do update
      set first_seen_at = least(
            app_private.case_external_references.first_seen_at,
            excluded.first_seen_at
          ),
          last_seen_at = greatest(
            app_private.case_external_references.last_seen_at,
            excluded.last_seen_at
          ),
          updated_at = greatest(
            app_private.case_external_references.updated_at,
            excluded.last_seen_at
          );

    if not exists (
      select 1 from app_private.case_external_references reference
       where reference.tenant_id = execution.tenant_id
         and reference.source_id = execution.source_id
         and reference.external_case_id = evidence_item->>'cnjNumber'
         and reference.case_id = resolved_case_id
    ) then
      raise exception 'external case reference conflict' using errcode = '23505';
    end if;

    insert into app_private.tenant_cases (
      tenant_id, tenant_case_id, case_id, granted_at
    ) values (
      execution.tenant_id,
      (evidence_item->>'tenantCaseId')::uuid,
      resolved_case_id,
      p_completed_at
    )
    on conflict (tenant_id, case_id) do nothing;
  end loop;

  if exists (
    select 1
      from jsonb_array_elements(p_evidence) item(value)
     group by value->>'externalId', value->>'contentHash'
    having count(distinct concat_ws(
      E'\x1f',
      value->>'parserVersion',
      value->>'schemaVersion',
      value->>'cnjNumber',
      value->>'tribunalCode',
      value->>'collectedAt'
    )) > 1
  ) then
    raise exception 'conflicting duplicate evidence' using errcode = '22023';
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'externalId', item.external_id,
             'contentHash', item.content_hash,
             'parserVersion', item.parser_version,
             'collectedAt', item.collected_at
           )),
           '[]'::jsonb
         )
    into receipt_items
    from (
      select distinct
             value->>'externalId' as external_id,
             value->>'contentHash' as content_hash,
             value->>'parserVersion' as parser_version,
             value->>'collectedAt' as collected_at
        from jsonb_array_elements(p_evidence)
    ) item;

  accepted := app_private.complete_monitoring_work_receipts(
    p_execution_id,
    p_lease_token_hash,
    p_completed_at,
    p_next_attempt_at,
    receipt_items,
    p_outcome_fingerprint,
    p_event_id
  );
  if not accepted then
    raise exception 'evidence completion conflict' using errcode = '23505';
  end if;
  return true;
end
$$;

revoke all on function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) from public;
grant execute on function app_private.complete_monitoring_work(
  uuid, bytea, timestamptz, timestamptz, jsonb, bytea, uuid
) to app_worker;

reset role;

commit;
