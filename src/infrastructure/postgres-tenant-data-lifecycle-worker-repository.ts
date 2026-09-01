import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import type {
  ClaimedTenantDataLifecycleWork,
  DueTenantExportExpiration,
  TenantDataLifecycleWorkerRepository,
} from "../application/tenant-data-lifecycle-worker.js";

export class TenantDataLifecycleWorkerValidationError extends Error {
  constructor() {
    super("Tenant data lifecycle worker input is invalid.");
    this.name = "TenantDataLifecycleWorkerValidationError";
  }
}

export class TenantDataLifecycleWorkerConflictError extends Error {
  constructor() {
    super("Tenant data lifecycle worker state was not accepted.");
    this.name = "TenantDataLifecycleWorkerConflictError";
  }
}

export class TenantDataLifecycleWorkerPersistenceError extends Error {
  constructor() {
    super("Tenant data lifecycle persistence operation failed.");
    this.name = "TenantDataLifecycleWorkerPersistenceError";
  }
}

interface ClaimRow extends QueryResultRow {
  claim_id: string;
  request_id: string;
  tenant_id: string;
  request_type: string;
  attempt_count: number;
}

interface SnapshotRow extends QueryResultRow { snapshot: unknown }
interface ObjectRow extends QueryResultRow { storage_object_id: string }
interface AcceptedRow extends QueryResultRow { accepted: boolean }
interface ExpirationRow extends QueryResultRow {
  request_id: string;
  tenant_id: string;
  storage_object_id: string;
}

type QueryablePool = Pick<Pool, "query">;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKER = /^[A-Za-z0-9._:-]{1,100}$/;
const FAILURE = /^[A-Z][A-Z0-9_]{2,63}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const UUID_PART =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OBJECT_ID = new RegExp(
  `^(?:documents/tenant/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.pdf|` +
  `exports/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.json)$`,
);

const validDate = (value: Date): boolean =>
  value instanceof Date && !Number.isNaN(value.getTime());
const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();
const validToken = (value: string): boolean =>
  typeof value === "string" && value.length >= 16 && value.length <= 256;

const validateClaimed = (input: ClaimedTenantDataLifecycleWork): void => {
  if (
    !UUID.test(input.requestId) || !UUID.test(input.tenantId) ||
    !["export", "deletion"].includes(input.requestType) ||
    !Number.isInteger(input.attemptCount) || input.attemptCount < 1 ||
    input.attemptCount > 3 || !validToken(input.leaseToken)
  ) throw new TenantDataLifecycleWorkerValidationError();
};

const accepted = (rows: readonly AcceptedRow[]): void => {
  if (rows.length !== 1 || rows[0]?.accepted !== true) {
    throw new TenantDataLifecycleWorkerConflictError();
  }
};

const mapError = (error: unknown): Error => {
  if (
    error instanceof TenantDataLifecycleWorkerValidationError ||
    error instanceof TenantDataLifecycleWorkerConflictError ||
    error instanceof TenantDataLifecycleWorkerPersistenceError
  ) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "22023" || code === "54000") {
    return new TenantDataLifecycleWorkerValidationError();
  }
  if (code && ["23503", "23505", "23514", "42501"].includes(code)) {
    return new TenantDataLifecycleWorkerConflictError();
  }
  return new TenantDataLifecycleWorkerPersistenceError();
};

export class PostgresTenantDataLifecycleWorkerRepository
implements TenantDataLifecycleWorkerRepository {
  constructor(
    private readonly pool: QueryablePool,
    private readonly createClaimId: () => string = randomUUID,
    private readonly createLeaseToken: () => string = () =>
      randomBytes(32).toString("base64url"),
  ) {}

  async claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedTenantDataLifecycleWork[]> {
    if (
      !WORKER.test(input.workerId) || !validDate(input.now) ||
      !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10 ||
      !Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 30_000 ||
      input.leaseDurationMs > 900_000
    ) throw new TenantDataLifecycleWorkerValidationError();
    const claims: ClaimedTenantDataLifecycleWork[] = [];
    try {
      for (let index = 0; index < input.limit; index += 1) {
        const claimId = this.createClaimId();
        const leaseToken = this.createLeaseToken();
        if (!UUID.test(claimId) || !validToken(leaseToken)) {
          throw new TenantDataLifecycleWorkerValidationError();
        }
        const result = await this.pool.query<ClaimRow>(
          `select claim_id, request_id, tenant_id, request_type, attempt_count
             from app_private.claim_tenant_data_lifecycle(
               $1::uuid, $2, $3::timestamptz, $4::timestamptz, $5::bytea
             )`,
          [claimId, input.workerId, input.now,
            new Date(input.now.getTime() + input.leaseDurationMs),
            digest(leaseToken)],
        );
        const row = result.rows[0];
        if (!row) break;
        if (
          result.rows.length !== 1 || row.claim_id !== claimId ||
          !UUID.test(row.request_id) || !UUID.test(row.tenant_id) ||
          !["export", "deletion"].includes(row.request_type) ||
          !Number.isInteger(row.attempt_count) || row.attempt_count < 1 ||
          row.attempt_count > 3
        ) throw new TenantDataLifecycleWorkerConflictError();
        claims.push({
          requestId: row.request_id,
          tenantId: row.tenant_id,
          requestType: row.request_type as "export" | "deletion",
          attemptCount: row.attempt_count,
          leaseToken,
        });
      }
      return claims;
    } catch (error) {
      throw mapError(error);
    }
  }

  async snapshotExport(input: ClaimedTenantDataLifecycleWork & {
    readonly generatedAt: Date;
  }): Promise<unknown> {
    validateClaimed(input);
    if (input.requestType !== "export" || !validDate(input.generatedAt)) {
      throw new TenantDataLifecycleWorkerValidationError();
    }
    try {
      const result = await this.pool.query<SnapshotRow>(
        `select app_private.snapshot_claimed_tenant_export(
           $1::uuid, $2::bytea, $3::timestamptz
         ) as snapshot`,
        [input.requestId, digest(input.leaseToken), input.generatedAt],
      );
      if (result.rows.length !== 1) {
        throw new TenantDataLifecycleWorkerConflictError();
      }
      return result.rows[0]!.snapshot;
    } catch (error) {
      throw mapError(error);
    }
  }

  async completeExport(input: ClaimedTenantDataLifecycleWork & {
    readonly completedAt: Date;
    readonly artifactId: string;
    readonly storageObjectId: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  }): Promise<void> {
    validateClaimed(input);
    const expected = `exports/${input.tenantId}/${input.requestId}/${input.artifactId}.json`;
    if (
      input.requestType !== "export" || !validDate(input.completedAt) ||
      !UUID.test(input.artifactId) || input.storageObjectId !== expected ||
      !HASH.test(input.sha256) || !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 || input.sizeBytes > 10 * 1024 * 1024
    ) throw new TenantDataLifecycleWorkerValidationError();
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.complete_tenant_data_export(
           $1::uuid, $2::bytea, $3::timestamptz, $4::uuid, $5, $6::bigint
         ) as accepted`,
        [input.requestId, digest(input.leaseToken), input.completedAt,
          input.artifactId, input.sha256, input.sizeBytes],
      );
      accepted(result.rows);
    } catch (error) {
      throw mapError(error);
    }
  }

  async listDeletionObjectIds(input: ClaimedTenantDataLifecycleWork & {
    readonly now: Date;
  }): Promise<readonly string[]> {
    validateClaimed(input);
    if (input.requestType !== "deletion" || !validDate(input.now)) {
      throw new TenantDataLifecycleWorkerValidationError();
    }
    try {
      const result = await this.pool.query<ObjectRow>(
        `select storage_object_id
           from app_private.list_claimed_tenant_object_ids(
             $1::uuid, $2::bytea, $3::timestamptz
           )`,
        [input.requestId, digest(input.leaseToken), input.now],
      );
      if (result.rows.some((row) =>
        typeof row.storage_object_id !== "string" ||
        !OBJECT_ID.test(row.storage_object_id))) {
        throw new TenantDataLifecycleWorkerConflictError();
      }
      return result.rows.map((row) => row.storage_object_id);
    } catch (error) {
      throw mapError(error);
    }
  }

  async completeDeletion(input: ClaimedTenantDataLifecycleWork & {
    readonly deletedAt: Date;
    readonly purgedObjectCount: number;
  }): Promise<void> {
    validateClaimed(input);
    if (
      input.requestType !== "deletion" || !validDate(input.deletedAt) ||
      !Number.isSafeInteger(input.purgedObjectCount) || input.purgedObjectCount < 0
    ) throw new TenantDataLifecycleWorkerValidationError();
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.purge_personal_tenant_data(
           $1::uuid, $2::bytea, $3::timestamptz, $4::bigint
         ) as accepted`,
        [input.requestId, digest(input.leaseToken), input.deletedAt,
          input.purgedObjectCount],
      );
      accepted(result.rows);
    } catch (error) {
      throw mapError(error);
    }
  }

  async fail(input: ClaimedTenantDataLifecycleWork & {
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void> {
    validateClaimed(input);
    if (
      !validDate(input.failedAt) || !FAILURE.test(input.failureCode) ||
      (input.terminal && input.nextAttemptAt !== null) ||
      (!input.terminal && (input.nextAttemptAt === null ||
        !validDate(input.nextAttemptAt) || input.nextAttemptAt <= input.failedAt))
    ) throw new TenantDataLifecycleWorkerValidationError();
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.fail_tenant_data_lifecycle(
           $1::uuid, $2::bytea, $3::timestamptz, $4,
           $5::timestamptz, $6::boolean
         ) as accepted`,
        [input.requestId, digest(input.leaseToken), input.failedAt,
          input.failureCode, input.nextAttemptAt, input.terminal],
      );
      accepted(result.rows);
    } catch (error) {
      throw mapError(error);
    }
  }

  async listDueExpirations(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly DueTenantExportExpiration[]> {
    if (
      !validDate(input.now) || !Number.isInteger(input.limit) ||
      input.limit < 1 || input.limit > 10
    ) throw new TenantDataLifecycleWorkerValidationError();
    try {
      const result = await this.pool.query<ExpirationRow>(
        `select request_id, tenant_id, storage_object_id
           from app_private.list_due_tenant_export_expirations(
             $1::timestamptz, $2::integer
           )`,
        [input.now, input.limit],
      );
      if (result.rows.length > input.limit || result.rows.some((row) =>
        !UUID.test(row.request_id) || !UUID.test(row.tenant_id) ||
        !OBJECT_ID.test(row.storage_object_id))) {
        throw new TenantDataLifecycleWorkerConflictError();
      }
      return result.rows.map((row) => ({
        requestId: row.request_id,
        tenantId: row.tenant_id,
        storageObjectId: row.storage_object_id,
      }));
    } catch (error) {
      throw mapError(error);
    }
  }

  async expireExport(input: {
    readonly requestId: string;
    readonly expiredAt: Date;
  }): Promise<void> {
    if (!UUID.test(input.requestId) || !validDate(input.expiredAt)) {
      throw new TenantDataLifecycleWorkerValidationError();
    }
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.expire_tenant_data_export(
           $1::uuid, $2::timestamptz
         ) as accepted`,
        [input.requestId, input.expiredAt],
      );
      accepted(result.rows);
    } catch (error) {
      throw mapError(error);
    }
  }
}
