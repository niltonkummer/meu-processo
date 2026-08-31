import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  DocumentMaterializationProjectionError,
  DocumentMaterializationRequestValidationError,
  type DocumentMaterializationRequestRepository,
  type DocumentMaterializationRequestResult,
  type DocumentMaterializationRequestState,
} from "../application/document-materialization-request.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

interface RequestRow extends QueryResultRow {
  materialization_id: string;
  document_id: string;
  state: string;
}

type ConnectablePool = Pick<Pool, "connect">;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set<DocumentMaterializationRequestState>([
  "queued", "processing", "available",
]);

const validContext = (context: RepositoryContext): boolean =>
  UUID.test(context.userId) && UUID.test(context.tenantId);

const mapResult = (
  rows: readonly RequestRow[],
): DocumentMaterializationRequestResult | null => {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new DocumentMaterializationProjectionError();
  const row = rows[0]!;
  if (
    !UUID.test(row.materialization_id) ||
    !UUID.test(row.document_id) ||
    !STATES.has(row.state as DocumentMaterializationRequestState)
  ) throw new DocumentMaterializationProjectionError();
  return {
    materializationId: row.materialization_id,
    documentId: row.document_id,
    state: row.state as DocumentMaterializationRequestState,
  };
};

const mapError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof DocumentMaterializationRequestValidationError ||
    error instanceof DocumentMaterializationProjectionError
  ) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") {
    return new DocumentMaterializationRequestValidationError();
  }
  return new Error("Document materialization request failed.");
};

export class PostgresDocumentMaterializationRequestRepository
  implements DocumentMaterializationRequestRepository
{
  constructor(private readonly pool: ConnectablePool) {}

  async request(
    context: RepositoryContext,
    input: {
      readonly caseId: string;
      readonly documentId: string;
      readonly materializationId: string;
      readonly requestedAt: Date;
    },
  ): Promise<DocumentMaterializationRequestResult | null> {
    if (
      !validContext(context) || !UUID.test(input.caseId) ||
      !UUID.test(input.documentId) || !UUID.test(input.materializationId) ||
      !(input.requestedAt instanceof Date) ||
      Number.isNaN(input.requestedAt.getTime())
    ) throw new DocumentMaterializationRequestValidationError();
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<RequestRow>(
          `select * from app_private.request_tenant_document_materialization(
             $1::uuid, $2::uuid, $3::uuid, $4::timestamptz
           )`,
          [input.caseId, input.documentId, input.materializationId,
            input.requestedAt],
        );
        return mapResult(result.rows);
      });
    } catch (error) {
      throw mapError(error);
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
