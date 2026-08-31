import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  type FoundationRepository,
  type MonitoredSubject,
  type MonitoredSubjectInput,
  type MonitoredSubjectUpdate,
  type MonitoringTarget,
  type MonitoringTargetInput,
  type MonitoringTargetUpdate,
  type PersonalTenantInput,
  RepositoryAccessDeniedError,
  RepositoryConflictError,
  RepositoryValidationError,
  type RepositoryContext,
  type ScheduledMonitoringProfileInput,
  type SubjectPage,
  type SubjectPageRequest,
  type TargetPage,
  type TargetPageRequest,
  type TargetSourceState,
  type TargetSourceStateInput,
  type TargetSourceStateUpdate,
  validatePageLimit,
} from "../application/foundation-repository.js";

interface SubjectRow extends QueryResultRow {
  tenant_id: string;
  subject_id: string;
  subject_type: MonitoredSubject["subjectType"];
  display_label: string;
  status: MonitoredSubject["status"];
  version: string;
  archived_at: Date | null;
}

interface TargetRow extends QueryResultRow {
  tenant_id: string;
  target_id: string;
  target_type: MonitoringTarget["targetType"];
  display_label: string;
  protected_reference: string;
  jurisdiction: string;
  status: MonitoringTarget["status"];
  next_check_at: Date | null;
  version: string;
  archived_at: Date | null;
}

interface TargetSourceStateRow extends QueryResultRow {
  tenant_id: string;
  state_id: string;
  target_id: string;
  source_id: string;
  status: TargetSourceState["status"];
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  next_attempt_at: Date | null;
  consecutive_failures: number;
  version: string;
}

const mapSubject = (row: SubjectRow): MonitoredSubject => ({
  tenantId: row.tenant_id,
  subjectId: row.subject_id,
  subjectType: row.subject_type,
  displayLabel: row.display_label,
  status: row.status,
  version: Number(row.version),
  archivedAt: row.archived_at,
});

const mapTarget = (row: TargetRow): MonitoringTarget => ({
  tenantId: row.tenant_id,
  targetId: row.target_id,
  targetType: row.target_type,
  displayLabel: row.display_label,
  protectedReference: row.protected_reference,
  jurisdiction: row.jurisdiction,
  status: row.status,
  nextCheckAt: row.next_check_at,
  version: Number(row.version),
  archivedAt: row.archived_at,
});

const mapTargetSourceState = (
  row: TargetSourceStateRow,
): TargetSourceState => ({
  tenantId: row.tenant_id,
  stateId: row.state_id,
  targetId: row.target_id,
  sourceId: row.source_id,
  status: row.status,
  lastAttemptAt: row.last_attempt_at,
  lastSuccessAt: row.last_success_at,
  nextAttemptAt: row.next_attempt_at,
  consecutiveFailures: row.consecutive_failures,
  version: Number(row.version),
});

const mapDatabaseError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof RepositoryConflictError ||
    error instanceof RepositoryValidationError
  ) {
    return error;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code && ["23503", "23505", "23514"].includes(code)) {
    return new RepositoryConflictError();
  }
  return error instanceof Error ? error : new Error("Database operation failed.");
};

export class PostgresFoundationRepository implements FoundationRepository {
  constructor(private readonly pool: Pool) {}

  async provisionPersonalTenant(input: PersonalTenantInput): Promise<void> {
    await this.withTransaction(input, false, async (client) => {
      await client.query(
        `insert into app_private.user_accounts (user_id, provider_subject)
         values ($1::uuid, $2)
         on conflict do nothing`,
        [input.userId, input.providerSubject],
      );
      await client.query(
        `insert into app_private.tenants (
           tenant_id,
           tenant_kind,
           personal_owner_user_id
         ) values ($1::uuid, 'personal', $2::uuid)
         on conflict do nothing`,
        [input.tenantId, input.userId],
      );
      await client.query(
        `insert into app_private.tenant_members (
           tenant_id,
           user_id,
           membership_role
         ) values ($1::uuid, $2::uuid, 'owner')
         on conflict (tenant_id, user_id) do nothing`,
        [input.tenantId, input.userId],
      );
      const exactProvision = await client.query<{ exact: boolean }>(
        `select
           exists (
             select 1
               from app_private.user_accounts
              where user_id = $1::uuid
                and provider_subject = $3
           )
           and exists (
             select 1
               from app_private.tenants
              where tenant_id = $2::uuid
                and tenant_kind = 'personal'
                and personal_owner_user_id = $1::uuid
           )
           and exists (
             select 1
               from app_private.tenant_members
              where tenant_id = $2::uuid
                and user_id = $1::uuid
                and membership_role = 'owner'
                and active = true
           ) as exact`,
        [input.userId, input.tenantId, input.providerSubject],
      );
      if (!exactProvision.rows[0]?.exact) throw new RepositoryConflictError();
    });
  }

  async createMonitoredSubject(
    context: RepositoryContext,
    input: MonitoredSubjectInput,
  ): Promise<MonitoredSubject> {
    return this.withTransaction(context, true, async (client) => {
      await client.query(
        `insert into app_private.monitored_subjects (
           tenant_id,
           subject_id,
           subject_type,
           display_label,
           protected_reference,
           encrypted_value,
           key_version
         ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         on conflict (tenant_id, subject_id) do nothing`,
        [
          context.tenantId,
          input.subjectId,
          input.subjectType,
          input.displayLabel,
          input.protectedReference,
          input.encryptedValue,
          input.keyVersion,
        ],
      );
      const exactSubject = await client.query<SubjectRow>(
        `select tenant_id, subject_id, subject_type, display_label,
                status, version, archived_at
           from app_private.monitored_subjects
            where tenant_id = $1::uuid
              and subject_id = $2::uuid
              and subject_type = $3
              and display_label = $4
              and protected_reference = $5
              and encrypted_value = $6
              and key_version = $7
              and status = 'active'`,
        [
          context.tenantId,
          input.subjectId,
          input.subjectType,
          input.displayLabel,
          input.protectedReference,
          input.encryptedValue,
          input.keyVersion,
        ],
      );
      const row = exactSubject.rows[0];
      if (!row) throw new RepositoryConflictError();
      return mapSubject(row);
    });
  }

  async createScheduledMonitoringProfile(
    context: RepositoryContext,
    input: ScheduledMonitoringProfileInput,
  ): Promise<MonitoredSubject> {
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<SubjectRow>(
        `select tenant_id, subject_id, subject_type, display_label,
                status, version, archived_at
           from app_private.register_monitoring_profile(
             $1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid,
             $9, $10::uuid, $11::timestamptz
           )`,
        [
          input.subjectId,
          input.subjectType,
          input.displayLabel,
          input.protectedReference,
          input.encryptedValue,
          input.keyVersion,
          input.targetId,
          input.stateId,
          input.sourceCode,
          input.eventId,
          input.scheduledAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      return mapSubject(row);
    });
  }

  async listMonitoredSubjects(
    context: RepositoryContext,
    page: SubjectPageRequest,
  ): Promise<SubjectPage> {
    validatePageLimit(page.limit);
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<SubjectRow>(
        `select
           tenant_id,
           subject_id,
           subject_type,
           display_label,
           status,
           version,
           archived_at
         from app_private.monitored_subjects
         where tenant_id = $1::uuid
           and ($2::uuid is null or subject_id > $2::uuid)
           and ($4::boolean or status = 'active')
         order by subject_id
         limit $3`,
        [
          context.tenantId,
          page.afterSubjectId ?? null,
          page.limit + 1,
          page.includeInactive === true,
        ],
      );
      const hasNextPage = result.rows.length > page.limit;
      const rows = result.rows.slice(0, page.limit);
      const items = rows.map(mapSubject);
      return {
        items,
        nextCursor: hasNextPage ? (items.at(-1)?.subjectId ?? null) : null,
      };
    });
  }

  async updateMonitoredSubject(
    context: RepositoryContext,
    input: MonitoredSubjectUpdate,
  ): Promise<MonitoredSubject> {
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<SubjectRow>(
        `update app_private.monitored_subjects
            set display_label = $3,
                version = version + 1,
                updated_at = statement_timestamp()
          where tenant_id = $1::uuid
            and subject_id = $2::uuid
            and version = $4
            and status = 'active'
        returning tenant_id, subject_id, subject_type, display_label,
                  status, version, archived_at`,
        [
          context.tenantId,
          input.subjectId,
          input.displayLabel,
          input.expectedVersion,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      return mapSubject(row);
    });
  }

  async archiveMonitoredSubject(
    context: RepositoryContext,
    subjectId: string,
    expectedVersion: number,
  ): Promise<MonitoredSubject> {
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<SubjectRow>(
        `update app_private.monitored_subjects
            set status = 'inactive',
                archived_at = statement_timestamp(),
                version = version + 1,
                updated_at = statement_timestamp()
          where tenant_id = $1::uuid
            and subject_id = $2::uuid
            and version = $3
            and status = 'active'
        returning tenant_id, subject_id, subject_type, display_label,
                  status, version, archived_at`,
        [context.tenantId, subjectId, expectedVersion],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      await client.query(
        `with archived_targets as (
           update app_private.monitoring_targets target
              set status = 'inactive',
                  next_check_at = null,
                  archived_at = statement_timestamp(),
                  version = version + 1,
                  updated_at = statement_timestamp()
            where target.tenant_id = $1::uuid
              and target.status = 'active'
              and exists (
                select 1 from app_private.subject_targets link
                 where link.tenant_id = target.tenant_id
                   and link.target_id = target.target_id
                   and link.subject_id = $2::uuid
              )
              and not exists (
                select 1
                  from app_private.subject_targets other_link
                  join app_private.monitored_subjects other_subject
                    on other_subject.tenant_id = other_link.tenant_id
                   and other_subject.subject_id = other_link.subject_id
                   and other_subject.status = 'active'
                 where other_link.tenant_id = target.tenant_id
                   and other_link.target_id = target.target_id
              )
          returning target_id
         )
         update app_private.target_source_states state
            set status = 'archived',
                next_attempt_at = null,
                version = version + 1,
                updated_at = statement_timestamp()
          where state.tenant_id = $1::uuid
            and state.target_id in (select target_id from archived_targets)
            and state.status <> 'archived'`,
        [context.tenantId, subjectId],
      );
      return mapSubject(row);
    });
  }

  async createMonitoringTarget(
    context: RepositoryContext,
    input: MonitoringTargetInput,
  ): Promise<void> {
    await this.withTransaction(context, true, async (client) => {
      await client.query(
        `insert into app_private.monitoring_targets (
           tenant_id,
           target_id,
           target_type,
           display_label,
           protected_reference,
           jurisdiction
         ) values ($1::uuid, $2::uuid, $3, $4, $5, $6)
         on conflict (tenant_id, target_id) do nothing`,
        [
          context.tenantId,
          input.targetId,
          input.targetType,
          input.displayLabel,
          input.protectedReference,
          input.jurisdiction,
        ],
      );
      const exactTarget = await client.query<{ exact: boolean }>(
        `select exists (
           select 1
             from app_private.monitoring_targets
            where tenant_id = $1::uuid
              and target_id = $2::uuid
              and target_type = $3
              and display_label = $4
              and protected_reference = $5
              and jurisdiction = $6
              and status = 'active'
         ) as exact`,
        [
          context.tenantId,
          input.targetId,
          input.targetType,
          input.displayLabel,
          input.protectedReference,
          input.jurisdiction,
        ],
      );
      if (!exactTarget.rows[0]?.exact) throw new RepositoryConflictError();
    });
  }

  async updateMonitoringTarget(
    context: RepositoryContext,
    input: MonitoringTargetUpdate,
  ): Promise<MonitoringTarget> {
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<TargetRow>(
        `update app_private.monitoring_targets
            set display_label = $3,
                version = version + 1,
                updated_at = statement_timestamp()
          where tenant_id = $1::uuid
            and target_id = $2::uuid
            and version = $4
            and status = 'active'
        returning tenant_id, target_id, target_type, display_label,
                  protected_reference, jurisdiction, status, next_check_at,
                  version, archived_at`,
        [
          context.tenantId,
          input.targetId,
          input.displayLabel,
          input.expectedVersion,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      return mapTarget(row);
    });
  }

  async archiveMonitoringTarget(
    context: RepositoryContext,
    targetId: string,
    expectedVersion: number,
  ): Promise<MonitoringTarget> {
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<TargetRow>(
        `update app_private.monitoring_targets
            set status = 'inactive',
                archived_at = statement_timestamp(),
                version = version + 1,
                updated_at = statement_timestamp()
          where tenant_id = $1::uuid
            and target_id = $2::uuid
            and version = $3
            and status = 'active'
        returning tenant_id, target_id, target_type, display_label,
                  protected_reference, jurisdiction, status, next_check_at,
                  version, archived_at`,
        [context.tenantId, targetId, expectedVersion],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      await client.query(
        `update app_private.target_source_states
            set status = 'archived',
                next_attempt_at = null,
                version = version + 1,
                updated_at = statement_timestamp()
          where tenant_id = $1::uuid
            and target_id = $2::uuid
            and status <> 'archived'`,
        [context.tenantId, targetId],
      );
      return mapTarget(row);
    });
  }

  async listMonitoringTargets(
    context: RepositoryContext,
    page: TargetPageRequest,
  ): Promise<TargetPage> {
    validatePageLimit(page.limit);
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<TargetRow>(
        `select tenant_id, target_id, target_type, display_label,
                protected_reference, jurisdiction, status, next_check_at,
                version, archived_at
           from app_private.monitoring_targets
          where tenant_id = $1::uuid
            and ($2::uuid is null or target_id > $2::uuid)
            and ($4::boolean or status = 'active')
          order by target_id
          limit $3`,
        [
          context.tenantId,
          page.afterTargetId ?? null,
          page.limit + 1,
          page.includeInactive === true,
        ],
      );
      const hasNextPage = result.rows.length > page.limit;
      const items = result.rows.slice(0, page.limit).map(mapTarget);
      return {
        items,
        nextCursor: hasNextPage ? (items.at(-1)?.targetId ?? null) : null,
      };
    });
  }

  async linkSubjectTarget(
    context: RepositoryContext,
    subjectId: string,
    targetId: string,
  ): Promise<void> {
    await this.withTransaction(context, true, async (client) => {
      await client.query(
        `insert into app_private.subject_targets (
           tenant_id,
           subject_id,
           target_id
         ) values ($1::uuid, $2::uuid, $3::uuid)
         on conflict (tenant_id, subject_id, target_id) do nothing`,
        [context.tenantId, subjectId, targetId],
      );
    });
  }

  async createTargetSourceState(
    context: RepositoryContext,
    input: TargetSourceStateInput,
  ): Promise<TargetSourceState> {
    return this.withTransaction(context, true, async (client) => {
      await client.query(
        `insert into app_private.target_source_states (
           tenant_id,
           state_id,
           target_id,
           source_id
         )
         select $1::uuid, $2::uuid, $3::uuid, $4::uuid
           from app_private.monitoring_targets
          where tenant_id = $1::uuid
            and target_id = $3::uuid
            and status = 'active'
         on conflict (tenant_id, state_id) do nothing`,
        [context.tenantId, input.stateId, input.targetId, input.sourceId],
      );
      const result = await client.query<TargetSourceStateRow>(
        `select tenant_id, state_id, target_id, source_id, status,
                last_attempt_at, last_success_at, next_attempt_at,
                consecutive_failures, version
           from app_private.target_source_states
          where tenant_id = $1::uuid
            and state_id = $2::uuid
            and target_id = $3::uuid
            and source_id = $4::uuid`,
        [context.tenantId, input.stateId, input.targetId, input.sourceId],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      return mapTargetSourceState(row);
    });
  }

  async updateTargetSourceState(
    context: RepositoryContext,
    input: TargetSourceStateUpdate,
  ): Promise<TargetSourceState> {
    return this.withTransaction(context, true, async (client) => {
      const result = await client.query<TargetSourceStateRow>(
        `update app_private.target_source_states
            set status = $3,
                last_attempt_at = $4,
                last_success_at = coalesce($5, last_success_at),
                next_attempt_at = $6,
                consecutive_failures = $7,
                version = version + 1,
                updated_at = statement_timestamp()
          where tenant_id = $1::uuid
            and state_id = $2::uuid
            and version = $8
        returning tenant_id, state_id, target_id, source_id, status,
                  last_attempt_at, last_success_at, next_attempt_at,
                  consecutive_failures, version`,
        [
          context.tenantId,
          input.stateId,
          input.status,
          input.attemptedAt,
          input.succeededAt ?? null,
          input.nextAttemptAt,
          input.consecutiveFailures,
          input.expectedVersion,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RepositoryConflictError();
      return mapTargetSourceState(row);
    });
  }

  private async withTransaction<T>(
    context: RepositoryContext,
    requireMembership: boolean,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local statement_timeout = '5s'");
      await client.query("set local idle_in_transaction_session_timeout = '5s'");
      await client.query(
        `select
           set_config('app.current_user_id', $1, true),
           set_config('app.current_tenant_id', $2, true)`,
        [context.userId, context.tenantId],
      );
      if (requireMembership) {
        const membership = await client.query<{ allowed: boolean }>(
          `select exists (
             select 1
               from app_private.tenant_members
              where tenant_id = $1::uuid
                and user_id = $2::uuid
                and active = true
           ) as allowed`,
          [context.tenantId, context.userId],
        );
        if (!membership.rows[0]?.allowed) {
          throw new RepositoryAccessDeniedError();
        }
      }
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
}
