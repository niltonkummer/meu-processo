import { createHash } from "node:crypto";

import type {
  IdentifierProtector,
  IdentifierRevealRequest,
} from "./protected-subject-factory.js";

export interface ClaimedTenantDataLifecycleWork {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requestType: "export" | "deletion";
  readonly attemptCount: number;
  readonly leaseToken: string;
}

export interface DueTenantExportExpiration {
  readonly requestId: string;
  readonly tenantId: string;
  readonly storageObjectId: string;
}

export interface TenantDataLifecycleWorkerRepository {
  claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedTenantDataLifecycleWork[]>;
  snapshotExport(input: ClaimedTenantDataLifecycleWork & {
    readonly generatedAt: Date;
  }): Promise<unknown>;
  completeExport(input: ClaimedTenantDataLifecycleWork & {
    readonly completedAt: Date;
    readonly artifactId: string;
    readonly storageObjectId: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  }): Promise<void>;
  listDeletionObjectIds(input: ClaimedTenantDataLifecycleWork & {
    readonly now: Date;
  }): Promise<readonly string[]>;
  completeDeletion(input: ClaimedTenantDataLifecycleWork & {
    readonly deletedAt: Date;
    readonly purgedObjectCount: number;
  }): Promise<void>;
  fail(input: ClaimedTenantDataLifecycleWork & {
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void>;
  listDueExpirations(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly DueTenantExportExpiration[]>;
  expireExport(input: {
    readonly requestId: string;
    readonly expiredAt: Date;
  }): Promise<void>;
}

export interface TenantLifecycleObjectStore {
  writeExport(input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly artifactId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<string>;
  deleteObject(storageObjectId: string): Promise<void>;
}

export interface TenantDataLifecycleWorkerConfig {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseDurationMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly maxAttempts: number;
  readonly maximumExportBytes: number;
  readonly expirationBatchSize: number;
}

export type TenantDataLifecycleMetric = {
  readonly requestId: string;
  readonly requestType: "export" | "deletion" | "expiration";
  readonly outcome:
    | "exported" | "deleted" | "expired" | "retry_scheduled"
    | "dead" | "expiration_failed" | "acknowledgement_failed";
  readonly failureCode?: string;
  readonly sizeBytes?: number;
};

export interface TenantDataLifecycleWorkerSummary {
  readonly expired: number;
  readonly expirationFailed: number;
  readonly claimed: number;
  readonly exported: number;
  readonly deleted: number;
  readonly retried: number;
  readonly dead: number;
  readonly acknowledgementFailed: number;
}

export class TenantDataLifecycleWorkerConfigurationError extends Error {
  constructor() {
    super("Tenant data lifecycle worker configuration is invalid.");
    this.name = "TenantDataLifecycleWorkerConfigurationError";
  }
}

class TenantLifecycleProcessingError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super("Tenant lifecycle processing failed.");
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKER = /^[A-Za-z0-9._:-]{1,100}$/;
const SUBJECT_TYPES = new Set(["name", "cpf", "cnpj"]);
const SUBJECT_STATUSES = new Set(["active", "inactive", "deleted"]);
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const MINUTE = 60_000;
const DAY = 86_400_000;
const OUTER_KEYS = [
  "schemaVersion", "generatedAt", "tenant", "protectedSubjects",
  "monitoringTargets", "cases", "events", "documents", "alerts",
  "operationalSummary", "omitted",
] as const;
const TENANT_KEYS = [
  "tenantId", "kind", "createdAt", "membershipRole", "membershipCreatedAt",
] as const;
const SUBJECT_KEYS = [
  "subjectId", "subjectType", "encryptedValue", "keyVersion", "status",
  "createdAt", "archivedAt",
] as const;
const FORBIDDEN_KEYS = new Set([
  "encryptedValue", "keyVersion", "protectedReference", "providerSubject",
  "leaseToken", "leaseTokenHash", "workerId", "artifactObjectId",
]);

const boundedInteger = (value: number, minimum: number, maximum: number): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

const validConfig = (value: TenantDataLifecycleWorkerConfig): boolean =>
  WORKER.test(value.workerId) && boundedInteger(value.batchSize, 1, 10) &&
  boundedInteger(value.leaseDurationMs, 30_000, 900_000) &&
  boundedInteger(value.baseBackoffMs, MINUTE, DAY) &&
  boundedInteger(value.maxBackoffMs, value.baseBackoffMs, DAY) &&
  boundedInteger(value.maxAttempts, 1, 3) &&
  boundedInteger(value.maximumExportBytes, 1, MAX_EXPORT_BYTES) &&
  boundedInteger(value.expirationBatchSize, 1, 10);

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): void => {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !(key in value))) {
    throw new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false);
  }
};

const validDateString = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 20 &&
  !Number.isNaN(new Date(value).getTime());
const hasControlCharacter = (
  value: string,
  allowJsonWhitespace: boolean,
): boolean => [...value].some((character) => {
  const code = character.codePointAt(0)!;
  return code <= 31 && (!allowJsonWhitespace || ![9, 10, 13].includes(code));
});

const validatePublicJson = (value: unknown): void => {
  if (
    value === null || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return;
  if (typeof value === "string") {
    if (
      value.includes("aes-256-gcm:") || value.includes("hmac-sha256:") ||
      hasControlCharacter(value, true)
    ) throw new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validatePublicJson(item);
    return;
  }
  const object = record(value);
  for (const [key, item] of Object.entries(object)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false);
    }
    validatePublicJson(item);
  }
};

interface ParsedSubject {
  readonly subjectId: string;
  readonly subjectType: "name" | "cpf" | "cnpj";
  readonly encryptedValue: string;
  readonly keyVersion: string;
  readonly status: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

const parseSubject = (value: unknown): ParsedSubject => {
  const subject = record(value);
  exactKeys(subject, SUBJECT_KEYS);
  if (
    typeof subject.subjectId !== "string" || !UUID.test(subject.subjectId) ||
    typeof subject.subjectType !== "string" ||
    !SUBJECT_TYPES.has(subject.subjectType) ||
    typeof subject.encryptedValue !== "string" ||
    subject.encryptedValue.length < 1 ||
    typeof subject.keyVersion !== "string" || subject.keyVersion.length < 1 ||
    typeof subject.status !== "string" || !SUBJECT_STATUSES.has(subject.status) ||
    !validDateString(subject.createdAt) ||
    (subject.archivedAt !== null && !validDateString(subject.archivedAt))
  ) throw new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false);
  return subject as unknown as ParsedSubject;
};

const revealSubject = (
  subject: ParsedSubject,
  tenantId: string,
  reveal: (request: IdentifierRevealRequest) => string,
): Record<string, unknown> => {
  let value: string;
  try {
    value = reveal({
      tenantId,
      identifierType: subject.subjectType,
      encryptedValue: subject.encryptedValue,
      keyVersion: subject.keyVersion,
    });
  } catch {
    throw new TenantLifecycleProcessingError("IDENTIFIER_REVEAL_FAILED", false);
  }
  if (
    typeof value !== "string" || value.length < 1 || value.length > 512 ||
    hasControlCharacter(value, false)
  ) throw new TenantLifecycleProcessingError("IDENTIFIER_REVEAL_FAILED", false);
  return {
    subjectId: subject.subjectId,
    subjectType: subject.subjectType,
    value,
    status: subject.status,
    createdAt: subject.createdAt,
    archivedAt: subject.archivedAt,
  };
};

const buildExport = (
  value: unknown,
  claim: ClaimedTenantDataLifecycleWork,
  generatedAt: Date,
  reveal: (request: IdentifierRevealRequest) => string,
): Uint8Array => {
  const snapshot = record(value);
  exactKeys(snapshot, OUTER_KEYS);
  const tenant = record(snapshot.tenant);
  exactKeys(tenant, TENANT_KEYS);
  if (
    snapshot.schemaVersion !== 1 || !validDateString(snapshot.generatedAt) ||
    new Date(snapshot.generatedAt).getTime() !== generatedAt.getTime() ||
    tenant.tenantId !== claim.tenantId || tenant.kind !== "personal" ||
    tenant.membershipRole !== "owner" || !validDateString(tenant.createdAt) ||
    !validDateString(tenant.membershipCreatedAt) ||
    !Array.isArray(snapshot.protectedSubjects) ||
    !Array.isArray(snapshot.monitoringTargets) || !Array.isArray(snapshot.cases) ||
    !Array.isArray(snapshot.events) || !Array.isArray(snapshot.documents) ||
    !Array.isArray(snapshot.alerts) || !Array.isArray(snapshot.omitted)
  ) throw new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false);
  const subjects = snapshot.protectedSubjects.map(parseSubject).map((subject) =>
    revealSubject(subject, claim.tenantId, reveal));
  const publicDocument = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    tenant,
    monitoredSubjects: subjects,
    monitoringTargets: snapshot.monitoringTargets,
    cases: snapshot.cases,
    events: snapshot.events,
    documents: snapshot.documents,
    alerts: snapshot.alerts,
    operationalSummary: snapshot.operationalSummary,
    omitted: snapshot.omitted,
  };
  validatePublicJson(publicDocument);
  return new TextEncoder().encode(`${JSON.stringify(publicDocument)}\n`);
};

const digest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const safeMetric = (
  sink: (metric: TenantDataLifecycleMetric) => void,
  metric: TenantDataLifecycleMetric,
): void => {
  try { sink(metric); } catch { /* Telemetry never changes lifecycle state. */ }
};

export class TenantDataLifecycleWorker {
  private readonly reveal: (request: IdentifierRevealRequest) => string;

  constructor(
    private readonly repository: TenantDataLifecycleWorkerRepository,
    private readonly store: TenantLifecycleObjectStore,
    protector: IdentifierProtector,
    private readonly metricSink: (metric: TenantDataLifecycleMetric) => void,
    private readonly config: TenantDataLifecycleWorkerConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly artifactId: () => string,
  ) {
    if (!validConfig(config)) {
      throw new TenantDataLifecycleWorkerConfigurationError();
    }
    this.reveal = protector.reveal
      ? (request) => protector.reveal!(request)
      : () => { throw new TenantLifecycleProcessingError(
          "IDENTIFIER_REVEAL_FAILED", false,
        ); };
  }

  async runTick(): Promise<TenantDataLifecycleWorkerSummary> {
    const startedAt = this.now();
    const summary = {
      expired: 0, expirationFailed: 0, claimed: 0,
      exported: 0, deleted: 0, retried: 0, dead: 0,
      acknowledgementFailed: 0,
    };
    const expirations = await this.repository.listDueExpirations({
      now: startedAt, limit: this.config.expirationBatchSize,
    });
    for (const expiration of expirations) {
      try {
        await this.store.deleteObject(expiration.storageObjectId);
        await this.repository.expireExport({
          requestId: expiration.requestId, expiredAt: startedAt,
        });
        summary.expired += 1;
        safeMetric(this.metricSink, {
          requestId: expiration.requestId, requestType: "expiration",
          outcome: "expired",
        });
      } catch {
        summary.expirationFailed += 1;
        safeMetric(this.metricSink, {
          requestId: expiration.requestId, requestType: "expiration",
          outcome: "expiration_failed", failureCode: "STORAGE_OR_STATE_FAILED",
        });
      }
    }

    const claimed = await this.repository.claimDue({
      workerId: this.config.workerId,
      now: startedAt,
      limit: this.config.batchSize,
      leaseDurationMs: this.config.leaseDurationMs,
    });
    summary.claimed = claimed.length;
    for (const item of claimed) {
      if (item.requestType === "export") {
        await this.processExport(item, startedAt, summary);
      } else {
        await this.processDeletion(item, startedAt, summary);
      }
    }
    return summary;
  }

  private async processExport(
    item: ClaimedTenantDataLifecycleWork,
    startedAt: Date,
    summary: {
      exported: number; retried: number; dead: number;
      acknowledgementFailed: number;
    },
  ): Promise<void> {
    let snapshot: unknown;
    try {
      snapshot = await this.repository.snapshotExport({
        ...item, generatedAt: startedAt,
      });
    } catch {
      await this.recordFailure(item, startedAt, new TenantLifecycleProcessingError(
        "DATABASE_FAILED", true,
      ), summary);
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = buildExport(snapshot, item, startedAt, this.reveal);
    } catch (error) {
      await this.recordFailure(item, startedAt,
        error instanceof TenantLifecycleProcessingError ? error :
          new TenantLifecycleProcessingError("EXPORT_SNAPSHOT_INVALID", false),
        summary);
      return;
    }
    if (bytes.byteLength > this.config.maximumExportBytes) {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("EXPORT_TOO_LARGE", false), summary);
      return;
    }
    const artifactId = this.artifactId();
    if (!UUID.test(artifactId)) {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("ARTIFACT_ID_INVALID", false), summary);
      return;
    }
    const sha256 = digest(bytes);
    let storageObjectId: string;
    try {
      storageObjectId = await this.store.writeExport({
        tenantId: item.tenantId, requestId: item.requestId,
        artifactId, bytes, sha256,
      });
    } catch {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("STORAGE_FAILED", true), summary);
      return;
    }
    const expectedObjectId =
      `exports/${item.tenantId}/${item.requestId}/${artifactId}.json`;
    if (storageObjectId !== expectedObjectId) {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("STORAGE_FAILED", true), summary);
      return;
    }
    try {
      await this.repository.completeExport({
        ...item, completedAt: startedAt, artifactId, storageObjectId,
        sha256, sizeBytes: bytes.byteLength,
      });
      summary.exported += 1;
      safeMetric(this.metricSink, {
        requestId: item.requestId, requestType: "export", outcome: "exported",
        sizeBytes: bytes.byteLength,
      });
    } catch {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("ACKNOWLEDGEMENT_FAILED", true),
        summary);
    }
  }

  private async processDeletion(
    item: ClaimedTenantDataLifecycleWork,
    startedAt: Date,
    summary: {
      deleted: number; retried: number; dead: number;
      acknowledgementFailed: number;
    },
  ): Promise<void> {
    let objectIds: readonly string[];
    try {
      objectIds = await this.repository.listDeletionObjectIds({
        ...item, now: startedAt,
      });
    } catch {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("DATABASE_FAILED", true), summary);
      return;
    }
    try {
      for (const objectId of objectIds) await this.store.deleteObject(objectId);
    } catch {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("STORAGE_FAILED", true), summary);
      return;
    }
    try {
      await this.repository.completeDeletion({
        ...item, deletedAt: startedAt, purgedObjectCount: objectIds.length,
      });
      summary.deleted += 1;
      safeMetric(this.metricSink, {
        requestId: item.requestId, requestType: "deletion", outcome: "deleted",
      });
    } catch {
      await this.recordFailure(item, startedAt,
        new TenantLifecycleProcessingError("ACKNOWLEDGEMENT_FAILED", true),
        summary);
    }
  }

  private async recordFailure(
    item: ClaimedTenantDataLifecycleWork,
    failedAt: Date,
    failure: TenantLifecycleProcessingError,
    summary: {
      retried: number; dead: number; acknowledgementFailed: number;
    },
  ): Promise<void> {
    const terminal = !failure.retryable ||
      item.attemptCount >= this.config.maxAttempts;
    const delay = Math.min(
      this.config.baseBackoffMs * 2 ** Math.max(0, item.attemptCount - 1),
      this.config.maxBackoffMs,
    );
    const nextAttemptAt = terminal ? null : new Date(failedAt.getTime() + delay);
    try {
      await this.repository.fail({
        ...item, failedAt, failureCode: failure.code, nextAttemptAt, terminal,
      });
    } catch {
      summary.acknowledgementFailed += 1;
      safeMetric(this.metricSink, {
        requestId: item.requestId, requestType: item.requestType,
        outcome: "acknowledgement_failed",
      });
      return;
    }
    if (terminal) summary.dead += 1;
    else summary.retried += 1;
    safeMetric(this.metricSink, {
      requestId: item.requestId, requestType: item.requestType,
      outcome: terminal ? "dead" : "retry_scheduled",
      failureCode: failure.code,
    });
  }
}
