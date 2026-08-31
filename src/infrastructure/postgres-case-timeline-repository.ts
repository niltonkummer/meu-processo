import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  CaseTimelinePageValidationError,
  type CaseTimelineRepositoryPage,
  type PersistedCaseEventSource,
  type PersistedCaseTimelineRepository,
} from "../application/persisted-case-timeline.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

interface TimelineRow extends QueryResultRow {
  tenant_id: string;
  case_event_id: string;
  case_id: string;
  event_type: "publication";
  occurred_at: Date;
  title: string;
  plain_text_excerpt: string | null;
  sources: unknown;
}
interface VisibleRow extends QueryResultRow { visible: boolean }
type ConnectablePool = Pick<Pool, "connect">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CaseTimelineProjectionError extends Error {
  constructor() {
    super("Case timeline projection is invalid.");
    this.name = "CaseTimelineProjectionError";
  }
}

const parseSources = (value: unknown): readonly PersistedCaseEventSource[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new CaseTimelineProjectionError();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new CaseTimelineProjectionError();
    }
    const record = item as Record<string, unknown>;
    const collectedAt = new Date(String(record.collectedAt));
    if (
      Object.keys(record).length !== 3 ||
      typeof record.sourceId !== "string" ||
      record.sourceId.length < 2 || record.sourceId.length > 64 ||
      typeof record.official !== "boolean" ||
      typeof record.collectedAt !== "string" ||
      Number.isNaN(collectedAt.getTime())
    ) throw new CaseTimelineProjectionError();
    return { sourceId: record.sourceId, official: record.official, collectedAt };
  });
};

const mapError = (error: unknown): Error => {
  if (error instanceof RepositoryAccessDeniedError ||
      error instanceof CaseTimelinePageValidationError ||
      error instanceof CaseTimelineProjectionError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new CaseTimelinePageValidationError();
  return error instanceof Error ? error : new Error("Case timeline database operation failed.");
};

export class PostgresCaseTimelineRepository
  implements PersistedCaseTimelineRepository {
  constructor(private readonly pool: ConnectablePool) {}

  async list(context: RepositoryContext, caseId: string, page: CaseTimelineRepositoryPage) {
    if (!UUID.test(caseId) || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100 ||
        (page.after !== undefined &&
          (!UUID.test(page.after.caseEventId) || Number.isNaN(page.after.occurredAt.getTime())))) {
      throw new CaseTimelinePageValidationError();
    }
    try {
      return await this.withTransaction(context, async (client) => {
        const visibility = await client.query<VisibleRow>(
          "select app_private.tenant_case_is_visible($1::uuid) as visible",
          [caseId],
        );
        if (visibility.rows[0]?.visible !== true) {
          return { caseFound: false, items: [], next: null } as const;
        }
        const result = await client.query<TimelineRow>(
          `select * from app_private.list_tenant_case_events(
             $1::uuid, $2::timestamptz, $3::uuid, $4::integer
           )`,
          [caseId, page.after?.occurredAt ?? null, page.after?.caseEventId ?? null, page.limit + 1],
        );
        const items = result.rows.slice(0, page.limit).map((row) => {
          if (!UUID.test(row.tenant_id) || !UUID.test(row.case_event_id) ||
              !UUID.test(row.case_id) || row.event_type !== "publication" ||
              Number.isNaN(row.occurred_at.getTime()) || row.title.length < 1 ||
              row.title.length > 200 ||
              (row.plain_text_excerpt !== null && row.plain_text_excerpt.length > 500)) {
            throw new CaseTimelineProjectionError();
          }
          return {
            tenantId: row.tenant_id,
            caseEventId: row.case_event_id,
            caseId: row.case_id,
            eventType: row.event_type,
            occurredAt: row.occurred_at,
            title: row.title,
            plainTextExcerpt: row.plain_text_excerpt,
            sources: parseSources(row.sources),
          };
        });
        const last = items.at(-1);
        return {
          caseFound: true,
          items,
          next: result.rows.length > page.limit && last
            ? { occurredAt: last.occurredAt, caseEventId: last.caseEventId }
            : null,
        };
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  private async withTransaction<T>(context: RepositoryContext, operation: (client: PoolClient) => Promise<T>) {
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

