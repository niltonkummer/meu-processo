import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  DocumentDeliveryValidationError,
  type DocumentAuthorizationResult,
  type DocumentDeliveryAuthorization,
  type DocumentDeliveryRepository,
  type DocumentDownloadOutcome,
} from "../application/individual-document-delivery.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

interface AuthorizationRow extends QueryResultRow {
  result_status: string;
  authorization_id: string | null;
  tenant_id: string | null;
  user_id: string | null;
  case_id: string | null;
  document_id: string | null;
  artifact_id: string | null;
  storage_object_id: string | null;
  title: string | null;
  media_type: string | null;
  size_bytes: number | null;
  content_hash: string | null;
}

interface OutcomeRow extends QueryResultRow { recorded: boolean }
type ConnectablePool = Pick<Pool, "connect">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const OUTCOMES = new Set<DocumentDownloadOutcome>([
  "delivered", "object_missing", "integrity_failed", "storage_failed",
]);
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

export class DocumentDeliveryProjectionError extends Error {
  constructor() {
    super("Document delivery projection is invalid.");
    this.name = "DocumentDeliveryProjectionError";
  }
}

const hasNullPrivateProjection = (row: AuthorizationRow): boolean => [
  row.authorization_id, row.tenant_id, row.user_id, row.case_id,
  row.document_id, row.artifact_id, row.storage_object_id, row.title,
  row.media_type, row.size_bytes, row.content_hash,
].every((value) => value === null);

const mapAuthorization = (row: AuthorizationRow): DocumentDeliveryAuthorization => {
  if (
    !UUID.test(row.authorization_id ?? "") || !UUID.test(row.tenant_id ?? "") ||
    !UUID.test(row.user_id ?? "") || !UUID.test(row.case_id ?? "") ||
    !UUID.test(row.document_id ?? "") || !UUID.test(row.artifact_id ?? "") ||
    row.storage_object_id !==
      `documents/tenant/${row.tenant_id}/${row.document_id}/${row.artifact_id}.pdf` ||
    typeof row.title !== "string" || row.title.length < 1 ||
    row.title.length > 200 || hasControlCharacter(row.title) ||
    row.media_type !== "application/pdf" || !Number.isInteger(row.size_bytes) ||
    (row.size_bytes ?? 0) < 1 || (row.size_bytes ?? 0) > 104857600 ||
    typeof row.content_hash !== "string" || !SHA256.test(row.content_hash)
  ) throw new DocumentDeliveryProjectionError();
  return {
    authorizationId: row.authorization_id!,
    tenantId: row.tenant_id!,
    userId: row.user_id!,
    caseId: row.case_id!,
    documentId: row.document_id!,
    artifactId: row.artifact_id!,
    storageObjectId: row.storage_object_id,
    title: row.title,
    mediaType: "application/pdf",
    sizeBytes: row.size_bytes!,
    sha256: row.content_hash,
  };
};

const mapDecision = (rows: readonly AuthorizationRow[]): DocumentAuthorizationResult => {
  if (rows.length !== 1) throw new DocumentDeliveryProjectionError();
  const row = rows[0]!;
  if (row.result_status === "authorized") {
    return { kind: "authorized", authorization: mapAuthorization(row) };
  }
  if (
    (row.result_status === "not_found" || row.result_status === "quota_exceeded") &&
    hasNullPrivateProjection(row)
  ) return { kind: row.result_status };
  throw new DocumentDeliveryProjectionError();
};

const mapError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof DocumentDeliveryValidationError ||
    error instanceof DocumentDeliveryProjectionError
  ) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new DocumentDeliveryValidationError();
  return error instanceof Error
    ? error : new Error("Document delivery database operation failed.");
};

const validContext = (context: RepositoryContext): boolean =>
  UUID.test(context.userId) && UUID.test(context.tenantId);

export class PostgresDocumentDeliveryRepository implements DocumentDeliveryRepository {
  constructor(private readonly pool: ConnectablePool) {}

  async authorize(
    context: RepositoryContext,
    input: {
      readonly caseId: string;
      readonly documentId: string;
      readonly authorizationId: string;
      readonly requestId: string;
      readonly quotaPerMinute: number;
    },
  ): Promise<DocumentAuthorizationResult> {
    if (!validContext(context) || !UUID.test(input.caseId) ||
        !UUID.test(input.documentId) || !UUID.test(input.authorizationId) ||
        !UUID.test(input.requestId) || !Number.isInteger(input.quotaPerMinute) ||
        input.quotaPerMinute < 1 || input.quotaPerMinute > 100) {
      throw new DocumentDeliveryValidationError();
    }
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<AuthorizationRow>(
          `select * from app_private.authorize_tenant_document_download(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer
           )`,
          [input.caseId, input.documentId, input.authorizationId,
            input.requestId, input.quotaPerMinute],
        );
        return mapDecision(result.rows);
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async recordOutcome(
    context: RepositoryContext,
    authorizationId: string,
    outcome: DocumentDownloadOutcome,
  ): Promise<boolean> {
    if (!validContext(context) || !UUID.test(authorizationId) ||
        !OUTCOMES.has(outcome)) throw new DocumentDeliveryValidationError();
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<OutcomeRow>(
          "select app_private.record_document_download_outcome($1::uuid, $2::text) as recorded",
          [authorizationId, outcome],
        );
        if (result.rows.length !== 1 ||
            typeof result.rows[0]?.recorded !== "boolean") {
          throw new DocumentDeliveryProjectionError();
        }
        return result.rows[0].recorded;
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
                set_config('lock_timeout', '3000', true),
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
