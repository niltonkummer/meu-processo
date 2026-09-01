import { createHash } from "node:crypto";

export interface ClaimedDocumentMaterialization {
  readonly executionId: string;
  readonly leaseToken: string;
  readonly tenantId: string;
  readonly jobId: string;
  readonly documentId: string;
  readonly sourceCode: string;
  readonly externalDocumentId: string;
  readonly expectedMediaType: "application/pdf";
  readonly attemptCount: number;
}

export interface DocumentMaterializationRepository {
  claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedDocumentMaterialization[]>;
  complete(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
    readonly artifactId: string;
    readonly storageObjectId: string;
    readonly contentHash: string;
    readonly mediaType: "application/pdf";
    readonly sizeBytes: number;
    readonly expiresAt: Date;
  }): Promise<void>;
  fail(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void>;
}

export interface DocumentMaterializationSourceAdapter {
  readonly sourceCode: string;
  fetch(input: {
    readonly executionId: string;
    readonly documentId: string;
    readonly externalDocumentId: string;
    readonly maximumBytes: number;
  }): Promise<unknown>;
}

export interface DocumentMaterializationSourceRegistry {
  resolve(sourceCode: string): DocumentMaterializationSourceAdapter | undefined;
}

export interface DocumentMalwareScanner {
  scan(input: {
    readonly stageToken: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<unknown>;
}

export interface DocumentMaterializationStore {
  stage(input: {
    readonly executionId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<{ readonly token: string }>;
  publish(input: {
    readonly stageToken: string;
    readonly tenantId: string;
    readonly documentId: string;
    readonly artifactId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<{ readonly storageObjectId: string }>;
  discard(stageToken: string): Promise<void>;
}

export interface DocumentMaterializationWorkerConfig {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseDurationMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly maxAttempts: number;
  readonly maximumBytes: number;
  readonly artifactTtlMs: number;
}

export type DocumentMaterializationMetric =
  | {
      readonly executionId: string;
      readonly sourceCode: string;
      readonly outcome: "succeeded";
      readonly sizeBytes: number;
    }
  | {
      readonly executionId: string;
      readonly sourceCode: string;
      readonly outcome: "retry_scheduled" | "dead";
      readonly failureCode: string;
    }
  | {
      readonly executionId: string;
      readonly sourceCode: string;
      readonly outcome: "acknowledgement_failed";
    };

export interface DocumentMaterializationWorkerSummary {
  readonly claimed: number;
  readonly succeeded: number;
  readonly retried: number;
  readonly dead: number;
  readonly acknowledgementFailed: number;
}

export class DocumentMaterializationWorkerConfigurationError extends Error {
  constructor() {
    super("Document materialization worker configuration is invalid.");
    this.name = "DocumentMaterializationWorkerConfigurationError";
  }
}

export class DocumentMaterializationSourceError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super("Document materialization source failed.");
    this.name = "DocumentMaterializationSourceError";
  }
}

export class DocumentMaterializationWorkValidationError extends Error {
  constructor() {
    super("Document materialization command is invalid.");
    this.name = "DocumentMaterializationWorkValidationError";
  }
}

export class DocumentMaterializationWorkConflictError extends Error {
  constructor() {
    super("Document materialization state conflict.");
    this.name = "DocumentMaterializationWorkConflictError";
  }
}

class InvalidDocumentError extends Error {}
class InvalidScannerOutcomeError extends Error {}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKER_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const FAILURE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const MAXIMUM_BYTES = 25 * 1024 * 1024;
const MINUTE = 60_000;
const DAY = 86_400_000;

const boundedInteger = (value: number, minimum: number, maximum: number): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

const validConfig = (value: DocumentMaterializationWorkerConfig): boolean =>
  WORKER_PATTERN.test(value.workerId) &&
  boundedInteger(value.batchSize, 1, 10) &&
  boundedInteger(value.leaseDurationMs, 30_000, 900_000) &&
  boundedInteger(value.baseBackoffMs, MINUTE, DAY) &&
  boundedInteger(value.maxBackoffMs, value.baseBackoffMs, DAY) &&
  boundedInteger(value.maxAttempts, 1, 20) &&
  boundedInteger(value.maximumBytes, 1, MAXIMUM_BYTES) &&
  boundedInteger(value.artifactTtlMs, 3_600_000, 7 * DAY);

const parseDocument = (
  value: unknown,
  maximumBytes: number,
): { readonly bytes: Uint8Array; readonly sha256: string } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidDocumentError();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !keys.includes("mediaType") ||
    !keys.includes("bytes") ||
    record.mediaType !== "application/pdf" ||
    !(record.bytes instanceof Uint8Array) ||
    record.bytes.byteLength < 5 ||
    record.bytes.byteLength > maximumBytes ||
    Buffer.from(record.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    throw new InvalidDocumentError();
  }
  return {
    bytes: record.bytes,
    sha256: `sha256:${createHash("sha256").update(record.bytes).digest("hex")}`,
  };
};

const parseScannerOutcome = (value: unknown): "clean" | "infected" => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidScannerOutcomeError();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    (record.status !== "clean" && record.status !== "infected")
  ) {
    throw new InvalidScannerOutcomeError();
  }
  return record.status;
};

const safeMetric = (
  sink: (metric: DocumentMaterializationMetric) => void,
  metric: DocumentMaterializationMetric,
): void => {
  try {
    sink(metric);
  } catch {
    // Telemetry never changes a persisted materialization outcome.
  }
};

export class DocumentMaterializationWorker {
  constructor(
    private readonly repository: DocumentMaterializationRepository,
    private readonly sources: DocumentMaterializationSourceRegistry,
    private readonly scanner: DocumentMalwareScanner,
    private readonly store: DocumentMaterializationStore,
    private readonly metricSink: (metric: DocumentMaterializationMetric) => void,
    private readonly config: DocumentMaterializationWorkerConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly artifactId: (input: {
      readonly tenantId: string;
      readonly documentId: string;
      readonly contentHash: string;
    }) => string,
  ) {
    if (!validConfig(config)) {
      throw new DocumentMaterializationWorkerConfigurationError();
    }
  }

  async runTick(): Promise<DocumentMaterializationWorkerSummary> {
    const startedAt = this.now();
    const claimed = await this.repository.claimDue({
      workerId: this.config.workerId,
      now: startedAt,
      limit: this.config.batchSize,
      leaseDurationMs: this.config.leaseDurationMs,
    });
    const summary = {
      claimed: claimed.length,
      succeeded: 0,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 0,
    };
    for (const item of claimed) {
      await this.process(item, startedAt, summary);
    }
    return summary;
  }

  private async process(
    item: ClaimedDocumentMaterialization,
    startedAt: Date,
    summary: {
      succeeded: number;
      retried: number;
      dead: number;
      acknowledgementFailed: number;
    },
  ): Promise<void> {
    const source = this.sources.resolve(item.sourceCode);
    if (!source) {
      await this.recordFailure(
        item, startedAt, "SOURCE_ADAPTER_UNAVAILABLE", false, summary,
      );
      return;
    }

    let document: { readonly bytes: Uint8Array; readonly sha256: string };
    try {
      document = parseDocument(await source.fetch({
        executionId: item.executionId,
        documentId: item.documentId,
        externalDocumentId: item.externalDocumentId,
        maximumBytes: this.config.maximumBytes,
      }), this.config.maximumBytes);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        await this.recordFailure(item, startedAt, "DOCUMENT_INVALID", false, summary);
        return;
      }
      const sourceError = error instanceof DocumentMaterializationSourceError
        ? error
        : undefined;
      await this.recordFailure(
        item,
        startedAt,
        sourceError && FAILURE_PATTERN.test(sourceError.code)
          ? sourceError.code
          : "SOURCE_FAILED",
        sourceError?.retryable !== false,
        summary,
      );
      return;
    }

    let stageToken: string | undefined;
    try {
      const staged = await this.store.stage({
        executionId: item.executionId,
        bytes: document.bytes,
        sha256: document.sha256,
      });
      stageToken = staged.token;
    } catch {
      await this.recordFailure(item, startedAt, "STORAGE_FAILED", true, summary);
      return;
    }

    try {
      let scannerOutcome: "clean" | "infected";
      try {
        scannerOutcome = parseScannerOutcome(await this.scanner.scan({
          stageToken,
          bytes: document.bytes,
          sha256: document.sha256,
        }));
      } catch {
        await this.recordFailure(item, startedAt, "SCANNER_FAILED", true, summary);
        return;
      }
      if (scannerOutcome === "infected") {
        await this.recordFailure(item, startedAt, "MALWARE_INFECTED", false, summary);
        return;
      }

      const artifactId = this.artifactId({
        tenantId: item.tenantId,
        documentId: item.documentId,
        contentHash: document.sha256,
      });
      let published: { readonly storageObjectId: string };
      try {
        published = await this.store.publish({
          stageToken,
          tenantId: item.tenantId,
          documentId: item.documentId,
          artifactId,
          bytes: document.bytes,
          sha256: document.sha256,
        });
      } catch {
        await this.recordFailure(item, startedAt, "STORAGE_FAILED", true, summary);
        return;
      }

      try {
        await this.repository.complete({
          executionId: item.executionId,
          leaseToken: item.leaseToken,
          completedAt: startedAt,
          artifactId,
          storageObjectId: published.storageObjectId,
          contentHash: document.sha256,
          mediaType: "application/pdf",
          sizeBytes: document.bytes.byteLength,
          expiresAt: new Date(startedAt.getTime() + this.config.artifactTtlMs),
        });
      } catch {
        summary.acknowledgementFailed += 1;
        safeMetric(this.metricSink, {
          executionId: item.executionId,
          sourceCode: item.sourceCode,
          outcome: "acknowledgement_failed",
        });
        return;
      }
      summary.succeeded += 1;
      safeMetric(this.metricSink, {
        executionId: item.executionId,
        sourceCode: item.sourceCode,
        outcome: "succeeded",
        sizeBytes: document.bytes.byteLength,
      });
    } finally {
      try {
        await this.store.discard(stageToken);
      } catch {
        // A quarantine cleanup failure must not corrupt the durable outcome.
      }
    }
  }

  private async recordFailure(
    item: ClaimedDocumentMaterialization,
    failedAt: Date,
    failureCode: string,
    retryable: boolean,
    summary: { retried: number; dead: number; acknowledgementFailed: number },
  ): Promise<void> {
    const terminal = !retryable || item.attemptCount >= this.config.maxAttempts;
    const nextAttemptAt = terminal
      ? null
      : new Date(failedAt.getTime() + Math.min(
          this.config.maxBackoffMs,
          this.config.baseBackoffMs * 2 ** Math.max(0, item.attemptCount - 1),
        ));
    try {
      await this.repository.fail({
        executionId: item.executionId,
        leaseToken: item.leaseToken,
        failedAt,
        failureCode,
        nextAttemptAt,
        terminal,
      });
    } catch {
      summary.acknowledgementFailed += 1;
      safeMetric(this.metricSink, {
        executionId: item.executionId,
        sourceCode: item.sourceCode,
        outcome: "acknowledgement_failed",
      });
      return;
    }
    if (terminal) summary.dead += 1;
    else summary.retried += 1;
    safeMetric(this.metricSink, {
      executionId: item.executionId,
      sourceCode: item.sourceCode,
      outcome: terminal ? "dead" : "retry_scheduled",
      failureCode,
    });
  }
}

export const deterministicDocumentArtifactId = (input: {
  readonly tenantId: string;
  readonly documentId: string;
  readonly contentHash: string;
}): string => {
  if (
    !UUID_PATTERN.test(input.tenantId) ||
    !UUID_PATTERN.test(input.documentId) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.contentHash)
  ) {
    throw new DocumentMaterializationWorkerConfigurationError();
  }
  const bytes = createHash("sha256")
    .update(`${input.tenantId}\0${input.documentId}\0${input.contentHash}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
