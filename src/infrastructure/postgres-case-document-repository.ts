import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  CaseDocumentPageValidationError,
  type CaseDocumentCursor,
  type DocumentAccessClass,
  type DocumentAvailabilityStatus,
  type PersistedCaseDocument,
  type PersistedCaseDocumentRepository,
} from "../application/persisted-case-documents.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

interface DocumentRow extends QueryResultRow {
  tenant_id: string;
  document_id: string;
  case_id: string;
  case_event_id: string | null;
  title: string;
  document_type: string | null;
  access_class: DocumentAccessClass;
  availability_status: DocumentAvailabilityStatus;
  expected_media_type: string;
  source_created_at: Date;
  last_verified_at: Date;
  source_code: string;
  source_official: boolean;
  artifact_id: string | null;
  artifact_media_type: string | null;
  artifact_size_bytes: number | null;
  artifact_content_hash: string | null;
  artifact_expires_at: Date | null;
}

interface VisibleRow extends QueryResultRow { visible: boolean }
type ConnectablePool = Pick<Pool, "connect">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_TYPE = /^[a-z][a-z0-9_.-]{1,63}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ACCESS = new Set<DocumentAccessClass>(["public_official", "restricted", "unknown"]);
const AVAILABILITY = new Set<DocumentAvailabilityStatus>([
  "metadata_only", "available", "expired", "unavailable",
]);

export class CaseDocumentProjectionError extends Error {
  constructor() {
    super("Case document projection is invalid.");
    this.name = "CaseDocumentProjectionError";
  }
}

const hasValidDates = (row: DocumentRow): boolean =>
  row.source_created_at instanceof Date &&
  !Number.isNaN(row.source_created_at.getTime()) &&
  row.last_verified_at instanceof Date &&
  !Number.isNaN(row.last_verified_at.getTime()) &&
  row.last_verified_at >= row.source_created_at;

const mapArtifact = (row: DocumentRow): PersistedCaseDocument["artifact"] => {
  const values = [row.artifact_id, row.artifact_media_type,
    row.artifact_size_bytes, row.artifact_content_hash, row.artifact_expires_at];
  if (values.every((value) => value === null)) return null;
  if (
    !UUID.test(row.artifact_id ?? "") ||
    row.artifact_media_type !== "application/pdf" ||
    !Number.isInteger(row.artifact_size_bytes) ||
    (row.artifact_size_bytes ?? 0) < 1 ||
    (row.artifact_size_bytes ?? 0) > 104857600 ||
    !SHA256.test(row.artifact_content_hash ?? "") ||
    !(row.artifact_expires_at instanceof Date) ||
    Number.isNaN(row.artifact_expires_at.getTime())
  ) throw new CaseDocumentProjectionError();
  return {
    artifactId: row.artifact_id!,
    mediaType: "application/pdf",
    sizeBytes: row.artifact_size_bytes!,
    sha256: row.artifact_content_hash!,
    expiresAt: row.artifact_expires_at,
  };
};

const mapRow = (row: DocumentRow): PersistedCaseDocument => {
  if (
    !UUID.test(row.tenant_id) || !UUID.test(row.document_id) ||
    !UUID.test(row.case_id) ||
    (row.case_event_id !== null && !UUID.test(row.case_event_id)) ||
    typeof row.title !== "string" || row.title.length < 1 || row.title.length > 200 ||
    (row.document_type !== null && !DOCUMENT_TYPE.test(row.document_type)) ||
    !ACCESS.has(row.access_class) || !AVAILABILITY.has(row.availability_status) ||
    row.expected_media_type !== "application/pdf" || !hasValidDates(row) ||
    typeof row.source_code !== "string" || row.source_code.length < 2 ||
    row.source_code.length > 64 || typeof row.source_official !== "boolean"
  ) throw new CaseDocumentProjectionError();
  return {
    tenantId: row.tenant_id,
    documentId: row.document_id,
    caseId: row.case_id,
    caseEventId: row.case_event_id,
    title: row.title,
    documentType: row.document_type,
    accessClass: row.access_class,
    availabilityStatus: row.availability_status,
    expectedMediaType: "application/pdf",
    sourceCreatedAt: row.source_created_at,
    lastVerifiedAt: row.last_verified_at,
    source: { sourceId: row.source_code, official: row.source_official },
    artifact: mapArtifact(row),
  };
};

const mapError = (error: unknown): Error => {
  if (error instanceof RepositoryAccessDeniedError ||
      error instanceof CaseDocumentPageValidationError ||
      error instanceof CaseDocumentProjectionError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new CaseDocumentPageValidationError();
  return error instanceof Error ? error : new Error("Case document database operation failed.");
};

export class PostgresCaseDocumentRepository
  implements PersistedCaseDocumentRepository {
  constructor(private readonly pool: ConnectablePool) {}

  async list(
    context: RepositoryContext,
    caseId: string,
    page: { readonly limit: number; readonly after?: CaseDocumentCursor },
  ) {
    if (!UUID.test(caseId) || !Number.isInteger(page.limit) ||
        page.limit < 1 || page.limit > 100 ||
        (page.after !== undefined &&
          (!UUID.test(page.after.documentId) ||
           Number.isNaN(page.after.sourceCreatedAt.getTime())))) {
      throw new CaseDocumentPageValidationError();
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
        const result = await client.query<DocumentRow>(
          `select * from app_private.list_tenant_case_documents(
             $1::uuid, $2::timestamptz, $3::uuid, $4::integer
           )`,
          [caseId, page.after?.sourceCreatedAt ?? null,
            page.after?.documentId ?? null, page.limit + 1],
        );
        const items = result.rows.slice(0, page.limit).map(mapRow);
        const last = items.at(-1);
        return {
          caseFound: true,
          items,
          next: result.rows.length > page.limit && last
            ? { sourceCreatedAt: last.sourceCreatedAt, documentId: last.documentId }
            : null,
        };
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  private async withTransaction<T>(
    context: RepositoryContext,
    operation: (client: PoolClient) => Promise<T>,
  ) {
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
