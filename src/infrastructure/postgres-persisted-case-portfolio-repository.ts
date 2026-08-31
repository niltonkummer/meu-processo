import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  type PersistedCasePage,
  type PersistedCasePageRequest,
  type PersistedCasePortfolioRepository,
  type PersistedCaseSource,
  PersistedCasePageValidationError,
  validatePersistedCasePage,
} from "../application/persisted-case-portfolio.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

interface CasePortfolioRow extends QueryResultRow {
  tenant_id: string;
  case_id: string;
  cnj_normalized: string;
  tribunal_code: string;
  identity_status: "confirmed";
  last_projected_at: Date;
  sources: unknown;
}

type ConnectablePool = Pick<Pool, "connect">;

export class PersistedCaseProjectionError extends Error {
  constructor() {
    super("Persisted case projection is invalid.");
    this.name = "PersistedCaseProjectionError";
  }
}

const parseSources = (value: unknown): readonly PersistedCaseSource[] => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new PersistedCaseProjectionError();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PersistedCaseProjectionError();
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    const collectedAt = new Date(String(record.collectedAt));
    if (
      keys.length !== 3 ||
      !keys.every((key) =>
        ["sourceId", "official", "collectedAt"].includes(key),
      ) ||
      typeof record.sourceId !== "string" ||
      record.sourceId.length < 2 ||
      record.sourceId.length > 64 ||
      typeof record.official !== "boolean" ||
      typeof record.collectedAt !== "string" ||
      Number.isNaN(collectedAt.getTime())
    ) {
      throw new PersistedCaseProjectionError();
    }
    return {
      sourceId: record.sourceId,
      official: record.official,
      collectedAt,
    };
  });
};

const mapDatabaseError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof PersistedCasePageValidationError ||
    error instanceof PersistedCaseProjectionError
  ) {
    return error;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new PersistedCasePageValidationError();
  return error instanceof Error
    ? error
    : new Error("Case portfolio database operation failed.");
};

export class PostgresPersistedCasePortfolioRepository
  implements PersistedCasePortfolioRepository
{
  constructor(private readonly pool: ConnectablePool) {}

  async list(
    context: RepositoryContext,
    page: PersistedCasePageRequest,
  ): Promise<PersistedCasePage> {
    validatePersistedCasePage(page);
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<CasePortfolioRow>(
          `select tenant_id, case_id, cnj_normalized, tribunal_code,
                  identity_status, last_projected_at, sources
             from app_private.list_tenant_case_summaries(
               $1::uuid, $2::integer
             )`,
          [page.afterCaseId ?? null, page.limit + 1],
        );
        const hasNextPage = result.rows.length > page.limit;
        const items = result.rows.slice(0, page.limit).map((row) => ({
          tenantId: row.tenant_id,
          caseId: row.case_id,
          cnjNumber: row.cnj_normalized,
          tribunal: row.tribunal_code,
          identityStatus: row.identity_status,
          lastUpdatedAt: row.last_projected_at,
          sources: parseSources(row.sources),
        }));
        return {
          items,
          nextCursor: hasNextPage ? (items.at(-1)?.caseId ?? null) : null,
        };
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
