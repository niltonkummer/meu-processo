import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  AlertNotFoundError,
  AlertPageValidationError,
  type AlertRepository,
  type AlertRepositoryPage,
  type PersistedAlert,
} from "../application/internal-alerts.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

interface AlertRow extends QueryResultRow {
  tenant_id: string;
  alert_id: string;
  subject_id: string;
  subject_label: string;
  tenant_case_id: string;
  case_id: string;
  case_event_id: string;
  cnj_normalized: string;
  tribunal_code: string;
  alert_type: "case_discovered";
  status: "unread" | "read";
  match_status: "unverified";
  source_occurred_at: Date;
  created_at: Date;
  read_at: Date | null;
}

type ConnectablePool = Pick<Pool, "connect">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AlertProjectionError extends Error {
  constructor() {
    super("Alert projection is invalid.");
    this.name = "AlertProjectionError";
  }
}

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const mapRow = (row: AlertRow): PersistedAlert => {
  if (
    !UUID.test(row.tenant_id) ||
    !UUID.test(row.alert_id) ||
    !UUID.test(row.subject_id) ||
    !UUID.test(row.tenant_case_id) ||
    !UUID.test(row.case_id) ||
    !UUID.test(row.case_event_id) ||
    row.subject_label.length < 1 ||
    row.subject_label.length > 200 ||
    !/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(row.cnj_normalized) ||
    !/^[A-Z][A-Z0-9-]{1,19}$/.test(row.tribunal_code) ||
    row.alert_type !== "case_discovered" ||
    !["unread", "read"].includes(row.status) ||
    row.match_status !== "unverified" ||
    !validDate(row.source_occurred_at) ||
    !validDate(row.created_at) ||
    (row.read_at !== null && !validDate(row.read_at))
  ) {
    throw new AlertProjectionError();
  }
  return {
    tenantId: row.tenant_id,
    alertId: row.alert_id,
    subjectId: row.subject_id,
    subjectLabel: row.subject_label,
    tenantCaseId: row.tenant_case_id,
    caseId: row.case_id,
    caseEventId: row.case_event_id,
    cnjNumber: row.cnj_normalized,
    tribunal: row.tribunal_code,
    alertType: row.alert_type,
    status: row.status,
    matchStatus: row.match_status,
    sourceOccurredAt: row.source_occurred_at,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
};

const mapDatabaseError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof AlertPageValidationError ||
    error instanceof AlertNotFoundError ||
    error instanceof AlertProjectionError
  ) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new AlertPageValidationError();
  return error instanceof Error ? error : new Error("Alert database operation failed.");
};

export class PostgresAlertRepository implements AlertRepository {
  constructor(private readonly pool: ConnectablePool) {}

  async list(context: RepositoryContext, page: AlertRepositoryPage) {
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<AlertRow>(
          `select * from app_private.list_tenant_alerts_v2(
             $1, $2::timestamptz, $3::uuid, $4::integer
           )`,
          [
            page.status,
            page.after?.createdAt ?? null,
            page.after?.alertId ?? null,
            page.limit + 1,
          ],
        );
        const hasNext = result.rows.length > page.limit;
        const items = result.rows.slice(0, page.limit).map(mapRow);
        const last = items.at(-1);
        return {
          items,
          next: hasNext && last
            ? { createdAt: last.createdAt, alertId: last.alertId }
            : null,
        };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async markRead(context: RepositoryContext, alertId: string, readAt: Date) {
    if (!UUID.test(alertId) || !validDate(readAt)) {
      throw new AlertPageValidationError();
    }
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<AlertRow>(
          `select * from app_private.mark_tenant_alert_read_v2(
             $1::uuid, $2::timestamptz
           )`,
          [alertId, readAt],
        );
        return result.rows[0] ? mapRow(result.rows[0]) : null;
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private async withTransaction<T>(
    context: RepositoryContext,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.current_user_id', $1, true),
                set_config('app.current_tenant_id', $2, true),
                set_config('statement_timeout', '5000', true),
                set_config('lock_timeout', '1000', true),
                set_config('idle_in_transaction_session_timeout', '5000', true)`,
        [context.userId, context.tenantId],
      );
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
