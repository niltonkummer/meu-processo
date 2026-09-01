#!/usr/bin/env bash
# Verify a logical backup and restore of the disposable local database.

set -euo pipefail
IFS=$'\n\t'

readonly SCRIPT_NAME="${0##*/}"
readonly EXPECTED_HOST="postgres"
readonly EXPECTED_SOURCE_DATABASE="meu_processo"
readonly DEFAULT_RESTORE_DATABASE="meu_processo_restore"
readonly MARKER_USER_ID="00000000-0000-7000-8000-000000000901"
readonly MARKER_PROVIDER_SUBJECT="provider-restore-drill-synthetic"

restore_database="${RESTORE_DATABASE:-${DEFAULT_RESTORE_DATABASE}}"
source_database="${PGDATABASE:-${EXPECTED_SOURCE_DATABASE}}"
temporary_directory=""
dump_file=""
restore_created=false

usage() {
  echo "Usage: ${SCRIPT_NAME} [--help]" >&2
  echo "Verifies backup/restore only for the local Compose PostgreSQL service." >&2
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

validate_database_name() {
  local database_name="$1"
  [[ "${database_name}" =~ ^[a-z][a-z0-9_]{2,62}$ ]] ||
    die "Database name is outside the local allowlist format."
}

parse_arguments() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

cleanup() {
  local exit_code=$?
  if [[ "${restore_created}" == "true" ]]; then
    dropdb --if-exists --force "${restore_database}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${dump_file}" && -f "${dump_file}" ]]; then
    rm -f "${dump_file}"
  fi
  if [[ -n "${temporary_directory}" && -d "${temporary_directory}" ]]; then
    rmdir "${temporary_directory}"
  fi
  exit "${exit_code}"
}

validate_environment() {
  [[ "${PGHOST:-}" == "${EXPECTED_HOST}" ]] ||
    die "Restore drill refuses a host outside local Compose."
  [[ "${source_database}" == "${EXPECTED_SOURCE_DATABASE}" ]] ||
    die "Restore drill refuses a source database outside the local allowlist."
  validate_database_name "${restore_database}"
  [[ "${restore_database}" != "${source_database}" ]] ||
    die "Restore database must differ from the source database."
  [[ -n "${PGUSER:-}" ]] || die "PGUSER is required."
  [[ -n "${PGPASSWORD:-}" ]] || die "PGPASSWORD is required."
}

seed_synthetic_marker() {
  psql --dbname "${source_database}" --set ON_ERROR_STOP=1 <<SQL
insert into app_private.user_accounts (user_id, provider_subject)
values ('${MARKER_USER_ID}', '${MARKER_PROVIDER_SUBJECT}')
on conflict (user_id) do update
set provider_subject = excluded.provider_subject;
SQL
}

create_and_restore_backup() {
  temporary_directory="$(mktemp -d /tmp/meu-processo-restore.XXXXXX)"
  dump_file="${temporary_directory}/database.dump"

  pg_dump \
    --dbname "${source_database}" \
    --format custom \
    --file "${dump_file}"

  dropdb --if-exists --force "${restore_database}"
  createdb --template template0 "${restore_database}"
  restore_created=true
  pg_restore \
    --dbname "${restore_database}" \
    --exit-on-error \
    "${dump_file}"
}

verify_restored_database() {
  psql --dbname "${restore_database}" --set ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if (select count(*) from app_private.user_accounts
       where user_id = '${MARKER_USER_ID}'::uuid
         and provider_subject = '${MARKER_PROVIDER_SUBJECT}') <> 1 then
    raise exception 'synthetic restore marker was not recovered';
  end if;

  if not (select relrowsecurity and relforcerowsecurity
            from pg_class
           where oid = 'app_private.target_source_states'::regclass) then
    raise exception 'forced RLS was not preserved';
  end if;

  if (select pg_get_userbyid(relowner)
        from pg_class
       where oid = 'app_private.target_source_states'::regclass)
     <> 'app_migrator' then
    raise exception 'table owner was not preserved';
  end if;

  if not has_table_privilege('app_runtime', 'app_private.sources', 'SELECT')
     or has_table_privilege('app_runtime', 'app_private.sources', 'INSERT')
     or has_table_privilege('app_runtime', 'app_private.sources', 'UPDATE')
     or has_table_privilege('app_runtime', 'app_private.sources', 'DELETE') then
    raise exception 'source catalog grants were not preserved';
  end if;

  if not has_table_privilege(
    'app_runtime',
    'app_private.target_source_states',
    'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception 'runtime state grants were not preserved';
  end if;

  if to_regclass('app_private.monitoring_executions') is null
     or to_regclass('app_private.monitoring_observation_receipts') is null
     or to_regclass('app_private.outbox_events') is null
     or to_regclass('app_private.consumer_inbox_receipts') is null then
    raise exception 'worker persistence tables were not restored';
  end if;

  if to_regclass('app_private.source_envelopes') is null
     or to_regclass('app_private.canonical_observations') is null
     or to_regclass('app_private.case_records') is null
     or to_regclass('app_private.case_external_references') is null
     or to_regclass('app_private.tenant_cases') is null then
    raise exception 'case evidence tables were not restored';
  end if;

  if not (
    select bool_and(relrowsecurity and relforcerowsecurity)
      from pg_class
     where oid in (
       'app_private.source_envelopes'::regclass,
       'app_private.canonical_observations'::regclass,
       'app_private.case_records'::regclass,
       'app_private.case_external_references'::regclass,
       'app_private.tenant_cases'::regclass
     )
  ) then
    raise exception 'case evidence forced RLS was not preserved';
  end if;

  if not (
    select bool_and(relrowsecurity and relforcerowsecurity)
      from pg_class
     where oid in (
       'app_private.monitoring_executions'::regclass,
       'app_private.monitoring_observation_receipts'::regclass,
       'app_private.outbox_events'::regclass,
       'app_private.consumer_inbox_receipts'::regclass
     )
  ) then
    raise exception 'worker forced RLS was not preserved';
  end if;

  if not (
    select bool_and(pg_get_userbyid(relowner) = 'app_migrator')
      from pg_class
     where oid in (
       'app_private.monitoring_executions'::regclass,
       'app_private.monitoring_observation_receipts'::regclass,
       'app_private.outbox_events'::regclass,
       'app_private.consumer_inbox_receipts'::regclass
     )
  ) then
    raise exception 'worker table ownership was not preserved';
  end if;

  if not exists (
    select 1
      from pg_roles
     where rolname = 'app_worker'
       and not rolsuper
       and not rolcreaterole
       and not rolcreatedb
       and not rolinherit
       and not rolbypassrls
  ) then
    raise exception 'restricted worker role was not preserved';
  end if;

  if not exists (
    select 1
      from pg_roles
     where rolname = 'app_dispatcher'
       and not rolsuper
       and not rolcreaterole
       and not rolcreatedb
       and not rolinherit
       and not rolbypassrls
  ) then
    raise exception 'restricted dispatcher role was not preserved';
  end if;

  if has_table_privilege(
       'app_worker', 'app_private.monitoring_executions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.monitoring_observation_receipts',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.outbox_events',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.source_envelopes',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.canonical_observations',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.case_records',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.case_external_references',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.tenant_cases',
       'SELECT,INSERT,UPDATE,DELETE'
     ) then
    raise exception 'worker direct table denial was not preserved';
  end if;

  if has_table_privilege(
       'app_dispatcher', 'app_private.outbox_events',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_dispatcher', 'app_private.consumer_inbox_receipts',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_worker', 'app_private.consumer_inbox_receipts',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'app_runtime', 'app_private.consumer_inbox_receipts',
       'SELECT,INSERT,UPDATE,DELETE'
     ) then
    raise exception 'dispatcher and inbox table denial was not preserved';
  end if;

  if not has_function_privilege(
       'app_worker',
       'app_private.claim_monitoring_work(uuid,text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'app_worker',
       'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'app_worker',
       'app_private.fail_monitoring_work(uuid,bytea,timestamptz,text,timestamptz,boolean,bytea,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_worker',
       'app_private.register_monitoring_profile(uuid,text,text,text,text,text,uuid,uuid,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_worker',
       'app_private.complete_monitoring_work_receipts(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)',
       'EXECUTE'
     ) then
    raise exception 'worker function grants were not preserved';
  end if;

  if not has_function_privilege(
       'app_runtime',
       'app_private.register_monitoring_profile(uuid,text,text,text,text,text,uuid,uuid,text,uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_runtime',
       'app_private.claim_monitoring_work(uuid,text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     ) then
    raise exception 'runtime function boundary was not preserved';
  end if;

  if not has_function_privilege(
       'app_runtime',
       'app_private.list_tenant_case_summaries(uuid,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_worker',
       'app_private.list_tenant_case_summaries(uuid,integer)',
       'EXECUTE'
     )
     or has_table_privilege(
       'app_runtime', 'app_private.case_records',
       'SELECT,INSERT,UPDATE,DELETE'
     ) then
    raise exception 'case portfolio privilege boundary was not preserved';
  end if;

  if not has_function_privilege(
       'app_dispatcher',
       'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'app_dispatcher',
       'app_private.complete_outbox_event(uuid,bytea,timestamptz)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'app_dispatcher',
       'app_private.fail_outbox_event(uuid,bytea,timestamptz,text,timestamptz,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_worker',
       'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_runtime',
       'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     ) then
    raise exception 'dispatcher function boundary was not preserved';
  end if;

  if not (
    select bool_and(prosecdef and proconfig is not null)
      from pg_proc
     where oid in (
       'app_private.claim_monitoring_work(uuid,text,timestamptz,timestamptz,bytea)'::regprocedure,
       'app_private.complete_monitoring_work(uuid,bytea,timestamptz,timestamptz,jsonb,bytea,uuid)'::regprocedure,
       'app_private.fail_monitoring_work(uuid,bytea,timestamptz,text,timestamptz,boolean,bytea,uuid)'::regprocedure,
       'app_private.register_monitoring_profile(uuid,text,text,text,text,text,uuid,uuid,text,uuid,timestamptz)'::regprocedure,
       'app_private.claim_outbox_event(text,timestamptz,timestamptz,bytea)'::regprocedure,
       'app_private.complete_outbox_event(uuid,bytea,timestamptz)'::regprocedure,
       'app_private.fail_outbox_event(uuid,bytea,timestamptz,text,timestamptz,boolean)'::regprocedure
     )
  ) then
    raise exception 'security definer configuration was not preserved';
  end if;

  if to_regclass('app_private.tenant_data_lifecycle_requests') is null
     or to_regclass('app_private.tenant_deletion_tombstones') is null then
    raise exception 'tenant lifecycle tables were not restored';
  end if;

  if not (
    select bool_and(relrowsecurity and relforcerowsecurity)
      from pg_class
     where oid in (
       'app_private.tenant_data_lifecycle_requests'::regclass,
       'app_private.tenant_deletion_tombstones'::regclass
     )
  ) then
    raise exception 'tenant lifecycle forced RLS was not preserved';
  end if;

  if not exists (
    select 1 from pg_roles
     where rolname='app_lifecycle_worker'
       and not rolsuper and not rolcreaterole and not rolcreatedb
       and not rolinherit and not rolbypassrls
  ) then
    raise exception 'restricted lifecycle worker role was not preserved';
  end if;

  if has_table_privilege(
       'app_lifecycle_worker',
       'app_private.tenant_data_lifecycle_requests',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or not has_function_privilege(
       'app_lifecycle_worker',
       'app_private.claim_tenant_data_lifecycle(uuid,text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     )
     or has_function_privilege(
       'app_runtime',
       'app_private.claim_tenant_data_lifecycle(uuid,text,timestamptz,timestamptz,bytea)',
       'EXECUTE'
     ) then
    raise exception 'tenant lifecycle privilege boundary was not preserved';
  end if;

  if not exists (
    select 1
      from app_private.sources
     where source_code = 'djen'
       and status = 'disabled'
       and terms_reviewed_at is null
  ) then
    raise exception 'DJEN safety gate was not preserved';
  end if;
end
\$\$;
SQL
}

main() {
  parse_arguments "$@"
  require_command psql
  require_command pg_dump
  require_command pg_restore
  require_command createdb
  require_command dropdb
  validate_environment
  seed_synthetic_marker
  create_and_restore_backup
  verify_restored_database
  echo "Backup and restore verification passed."
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

main "$@"
