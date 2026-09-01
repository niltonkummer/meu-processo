import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import {
  type ClaimedDocumentMaterialization,
  type DocumentMaterializationRepository,
  DocumentMaterializationWorkConflictError,
  DocumentMaterializationWorkValidationError,
} from "../application/document-materialization-worker.js";

interface ClaimRow extends QueryResultRow {
  execution_id: string;
  tenant_id: string;
  materialization_id: string;
  document_id: string;
  source_code: string;
  external_document_id: string;
  expected_media_type: string;
  attempt_count: number;
}

interface AcceptedRow extends QueryResultRow { accepted: boolean }
type QueryablePool = Pick<Pool, "query">;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKER_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const FAILURE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();
const fingerprint = (value: unknown): Buffer =>
  digest(JSON.stringify(value));

const mapError = (error: unknown): Error => {
  if (
    error instanceof DocumentMaterializationWorkValidationError ||
    error instanceof DocumentMaterializationWorkConflictError
  ) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
  if (code === "22023") return new DocumentMaterializationWorkValidationError();
  if (code && ["23503", "23505", "23514", "42501"].includes(code)) {
    return new DocumentMaterializationWorkConflictError();
  }
  return error instanceof Error
    ? error
    : new Error("Document materialization database operation failed.");
};

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());

export class PostgresDocumentMaterializationRepository
  implements DocumentMaterializationRepository
{
  constructor(
    private readonly pool: QueryablePool,
    private readonly createExecutionId: () => string = randomUUID,
    private readonly createLeaseToken: () => string = () =>
      randomBytes(32).toString("base64url"),
    private readonly createEventId: () => string = randomUUID,
  ) {}

  async claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedDocumentMaterialization[]> {
    if (
      !WORKER_PATTERN.test(input.workerId) ||
      !validDate(input.now) ||
      !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10 ||
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 30_000 || input.leaseDurationMs > 900_000
    ) throw new DocumentMaterializationWorkValidationError();

    const claimed: ClaimedDocumentMaterialization[] = [];
    try {
      for (let index = 0; index < input.limit; index += 1) {
        const executionId = this.createExecutionId();
        const leaseToken = this.createLeaseToken();
        if (!UUID_PATTERN.test(executionId) || leaseToken.length < 16) {
          throw new DocumentMaterializationWorkValidationError();
        }
        const result = await this.pool.query<ClaimRow>(
          `select execution_id, tenant_id, materialization_id, document_id,
                  source_code, external_document_id, expected_media_type,
                  attempt_count
             from app_private.claim_document_materialization(
               $1::uuid, $2, $3::timestamptz, $4::timestamptz, $5::bytea
             )`,
          [executionId, input.workerId, input.now,
            new Date(input.now.getTime() + input.leaseDurationMs),
            digest(leaseToken)],
        );
        const row = result.rows[0];
        if (!row) break;
        if (
          row.execution_id !== executionId ||
          !UUID_PATTERN.test(row.tenant_id) ||
          !UUID_PATTERN.test(row.materialization_id) ||
          !UUID_PATTERN.test(row.document_id) ||
          row.expected_media_type !== "application/pdf" ||
          !Number.isInteger(row.attempt_count) ||
          row.attempt_count < 1 || row.attempt_count > 20
        ) throw new DocumentMaterializationWorkConflictError();
        claimed.push({
          executionId,
          leaseToken,
          tenantId: row.tenant_id,
          jobId: row.materialization_id,
          documentId: row.document_id,
          sourceCode: row.source_code,
          externalDocumentId: row.external_document_id,
          expectedMediaType: "application/pdf",
          attemptCount: row.attempt_count,
        });
      }
      return claimed;
    } catch (error) {
      throw mapError(error);
    }
  }

  async complete(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
    readonly artifactId: string;
    readonly storageObjectId: string;
    readonly contentHash: string;
    readonly mediaType: "application/pdf";
    readonly sizeBytes: number;
    readonly expiresAt: Date;
  }): Promise<void> {
    if (
      !UUID_PATTERN.test(input.executionId) || input.leaseToken.length < 16 ||
      !validDate(input.completedAt) || !UUID_PATTERN.test(input.artifactId) ||
      input.storageObjectId.length < 64 || input.storageObjectId.length > 512 ||
      input.storageObjectId.includes("://") ||
      !HASH_PATTERN.test(input.contentHash) ||
      input.mediaType !== "application/pdf" ||
      !Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 ||
      input.sizeBytes > 25 * 1024 * 1024 || !validDate(input.expiresAt) ||
      input.expiresAt <= input.completedAt
    ) throw new DocumentMaterializationWorkValidationError();
    const outcome = fingerprint({
      kind: "complete",
      completedAt: input.completedAt.toISOString(),
      artifactId: input.artifactId,
      storageObjectId: input.storageObjectId,
      contentHash: input.contentHash,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      expiresAt: input.expiresAt.toISOString(),
    });
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.complete_document_materialization(
           $1::uuid, $2::bytea, $3::timestamptz, $4::uuid, $5, $6, $7,
           $8::integer, $9::timestamptz, $10, $11::bytea, $12::uuid
         ) as accepted`,
        [input.executionId, digest(input.leaseToken), input.completedAt,
          input.artifactId, input.storageObjectId, input.contentHash,
          input.mediaType, input.sizeBytes, input.expiresAt, "v1", outcome,
          this.createEventId()],
      );
      if (result.rows[0]?.accepted !== true) {
        throw new DocumentMaterializationWorkConflictError();
      }
    } catch (error) {
      throw mapError(error);
    }
  }

  async fail(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void> {
    if (
      !UUID_PATTERN.test(input.executionId) || input.leaseToken.length < 16 ||
      !validDate(input.failedAt) || !FAILURE_PATTERN.test(input.failureCode) ||
      (input.terminal && input.nextAttemptAt !== null) ||
      (!input.terminal &&
        (input.nextAttemptAt === null || !validDate(input.nextAttemptAt) ||
          input.nextAttemptAt <= input.failedAt))
    ) throw new DocumentMaterializationWorkValidationError();
    const outcome = fingerprint({
      kind: "fail",
      failedAt: input.failedAt.toISOString(),
      failureCode: input.failureCode,
      nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
      terminal: input.terminal,
    });
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.fail_document_materialization(
           $1::uuid, $2::bytea, $3::timestamptz, $4,
           $5::timestamptz, $6::boolean, $7::bytea, $8::uuid
         ) as accepted`,
        [input.executionId, digest(input.leaseToken), input.failedAt,
          input.failureCode, input.nextAttemptAt, input.terminal, outcome,
          this.createEventId()],
      );
      if (result.rows[0]?.accepted !== true) {
        throw new DocumentMaterializationWorkConflictError();
      }
    } catch (error) {
      throw mapError(error);
    }
  }
}
