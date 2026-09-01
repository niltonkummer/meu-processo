import type {
  IdentifierProtector,
  IdentifierRevealRequest,
} from "./protected-subject-factory.js";
import type { SubjectType } from "./foundation-repository.js";

export interface ClaimedMonitoringWork {
  readonly executionId: string;
  readonly leaseToken: string;
  readonly tenantId: string;
  readonly stateId: string;
  readonly targetId: string;
  readonly subjectId: string;
  readonly sourceCode: string;
  readonly subjectType: SubjectType;
  readonly encryptedValue: string;
  readonly keyVersion: string;
  readonly consecutiveFailures: number;
}

export interface MonitoringObservation {
  readonly externalId: string;
  readonly contentHash: string;
  readonly parserVersion: string;
  readonly schemaVersion: 1;
  readonly cnjNumber: string;
  readonly tribunalCode: string;
  readonly collectedAt: Date;
  readonly eventType: "publication";
  readonly externalEventKey: string;
  readonly occurredAt: Date;
  readonly title: string;
  readonly plainTextExcerpt: string | null;
}

export interface MonitoringSourceAdapter {
  readonly sourceCode: string;
  collect(input: {
    readonly executionId: string;
    readonly targetId: string;
    readonly type: SubjectType;
    readonly value: string;
  }): Promise<readonly MonitoringObservation[]>;
}

export interface MonitoringSourceRegistry {
  resolve(sourceCode: string): MonitoringSourceAdapter | undefined;
}

export interface MonitoringWorkRepository {
  claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedMonitoringWork[]>;
  complete(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
    readonly nextAttemptAt: Date;
    readonly observations: readonly MonitoringObservation[];
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

export type WorkerMetric =
  | {
      readonly executionId: string;
      readonly sourceCode: string;
      readonly outcome: "succeeded";
      readonly observationCount: number;
    }
  | {
      readonly executionId: string;
      readonly sourceCode: string;
      readonly outcome: "failed";
      readonly failureCode: string;
    };

export interface MonitoringWorkerConfig {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseDurationMs: number;
  readonly successIntervalMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly maxFailures: number;
}

export interface MonitoringWorkerSummary {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
}

export class MonitoringWorkerConfigurationError extends Error {
  constructor() {
    super("Monitoring worker configuration is invalid.");
    this.name = "MonitoringWorkerConfigurationError";
  }
}

export class MonitoringWorkConflictError extends Error {
  constructor() {
    super("Monitoring work state conflict.");
    this.name = "MonitoringWorkConflictError";
  }
}

export class MonitoringWorkValidationError extends Error {
  constructor() {
    super("Monitoring work command is invalid.");
    this.name = "MonitoringWorkValidationError";
  }
}

export class SourceCollectionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super("Monitoring source collection failed.");
    this.name = "SourceCollectionError";
  }
}

const MIN_SCHEDULE_MS = 300_000;
const MAX_SCHEDULE_MS = 7 * 86_400_000;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const TRIBUNAL_CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,19}$/;
const OBSERVATION_KEYS = new Set([
  "externalId",
  "contentHash",
  "parserVersion",
  "schemaVersion",
  "cnjNumber",
  "tribunalCode",
  "collectedAt",
  "eventType",
  "externalEventKey",
  "occurredAt",
  "title",
  "plainTextExcerpt",
]);

class InvalidSourceResponseError extends Error {}

const hasUnsafeControl = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });

const parseObservations = (value: unknown): readonly MonitoringObservation[] => {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new InvalidSourceResponseError();
  }
  const parsed = value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new InvalidSourceResponseError();
    }
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).length !== OBSERVATION_KEYS.size ||
      Object.keys(record).some((key) => !OBSERVATION_KEYS.has(key)) ||
      typeof record.externalId !== "string" ||
      record.externalId.length < 1 ||
      record.externalId.length > 255 ||
      typeof record.contentHash !== "string" ||
      !CONTENT_HASH_PATTERN.test(record.contentHash) ||
      typeof record.parserVersion !== "string" ||
      record.parserVersion.length < 1 ||
      record.parserVersion.length > 100 ||
      record.schemaVersion !== 1 ||
      typeof record.cnjNumber !== "string" ||
      !CNJ_PATTERN.test(record.cnjNumber) ||
      typeof record.tribunalCode !== "string" ||
      !TRIBUNAL_CODE_PATTERN.test(record.tribunalCode) ||
      !(record.collectedAt instanceof Date) ||
      Number.isNaN(record.collectedAt.getTime()) ||
      record.eventType !== "publication" ||
      typeof record.externalEventKey !== "string" ||
      record.externalEventKey.length < 1 ||
      record.externalEventKey.length > 255 ||
      !(record.occurredAt instanceof Date) ||
      Number.isNaN(record.occurredAt.getTime()) ||
      record.occurredAt.getTime() > record.collectedAt.getTime() ||
      typeof record.title !== "string" ||
      record.title.length < 1 ||
      record.title.length > 200 ||
      hasUnsafeControl(record.title) ||
      (record.plainTextExcerpt !== null &&
        (typeof record.plainTextExcerpt !== "string" ||
          record.plainTextExcerpt.length > 500 ||
          hasUnsafeControl(record.plainTextExcerpt)))
    ) {
      throw new InvalidSourceResponseError();
    }
    return {
      externalId: record.externalId,
      contentHash: record.contentHash,
      parserVersion: record.parserVersion,
      schemaVersion: 1 as const,
      cnjNumber: record.cnjNumber,
      tribunalCode: record.tribunalCode,
      collectedAt: new Date(record.collectedAt),
      eventType: "publication" as const,
      externalEventKey: record.externalEventKey,
      occurredAt: new Date(record.occurredAt),
      title: record.title,
      plainTextExcerpt: record.plainTextExcerpt,
    };
  });
  const deduplicated = new Map<string, MonitoringObservation>();
  for (const observation of parsed) {
    const key = `${observation.externalId}\0${observation.contentHash}`;
    const existing = deduplicated.get(key);
    if (
      existing &&
      (existing.parserVersion !== observation.parserVersion ||
        existing.cnjNumber !== observation.cnjNumber ||
        existing.tribunalCode !== observation.tribunalCode ||
        existing.collectedAt.getTime() !== observation.collectedAt.getTime() ||
        existing.eventType !== observation.eventType ||
        existing.externalEventKey !== observation.externalEventKey ||
        existing.occurredAt.getTime() !== observation.occurredAt.getTime() ||
        existing.title !== observation.title ||
        existing.plainTextExcerpt !== observation.plainTextExcerpt)
    ) {
      throw new InvalidSourceResponseError();
    }
    if (!existing) deduplicated.set(key, observation);
  }
  return [...deduplicated.values()];
};

const validConfig = (config: MonitoringWorkerConfig): boolean =>
  config.workerId.length >= 1 &&
  config.workerId.length <= 100 &&
  Number.isInteger(config.batchSize) &&
  config.batchSize >= 1 &&
  config.batchSize <= 25 &&
  Number.isInteger(config.leaseDurationMs) &&
  config.leaseDurationMs >= 30_000 &&
  config.leaseDurationMs <= 900_000 &&
  Number.isInteger(config.successIntervalMs) &&
  config.successIntervalMs >= MIN_SCHEDULE_MS &&
  config.successIntervalMs <= MAX_SCHEDULE_MS &&
  Number.isInteger(config.baseBackoffMs) &&
  config.baseBackoffMs >= MIN_SCHEDULE_MS &&
  config.baseBackoffMs <= MAX_SCHEDULE_MS &&
  Number.isInteger(config.maxBackoffMs) &&
  config.maxBackoffMs >= config.baseBackoffMs &&
  config.maxBackoffMs <= MAX_SCHEDULE_MS &&
  Number.isInteger(config.maxFailures) &&
  config.maxFailures >= 1 &&
  config.maxFailures <= 20;

const deterministicJitter = (value: string): number => {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % 21;
};

export class MonitoringWorker {
  private readonly reveal: (request: IdentifierRevealRequest) => string;

  constructor(
    private readonly repository: MonitoringWorkRepository,
    protector: IdentifierProtector,
    private readonly sources: MonitoringSourceRegistry,
    private readonly recordMetric: (metric: WorkerMetric) => void,
    private readonly config: MonitoringWorkerConfig,
    private readonly now: () => Date,
  ) {
    if (!protector.reveal || !validConfig(config)) {
      throw new MonitoringWorkerConfigurationError();
    }
    this.reveal = (request) => protector.reveal!(request);
  }

  async runTick(): Promise<MonitoringWorkerSummary> {
    const startedAt = this.now();
    const claims = await this.repository.claimDue({
      workerId: this.config.workerId,
      now: startedAt,
      limit: this.config.batchSize,
      leaseDurationMs: this.config.leaseDurationMs,
    });
    let succeeded = 0;
    let failed = 0;

    for (const work of claims) {
      const outcome = await this.process(work, startedAt);
      if (outcome === "succeeded") succeeded += 1;
      else failed += 1;
    }

    return { claimed: claims.length, succeeded, failed };
  }

  private async process(
    work: ClaimedMonitoringWork,
    startedAt: Date,
  ): Promise<"succeeded" | "failed"> {
    const adapter = this.sources.resolve(work.sourceCode);
    if (!adapter) {
      await this.recordFailure(work, startedAt, "SOURCE_DISABLED", true, null);
      return "failed";
    }

    let value: string;
    try {
      value = this.reveal({
        tenantId: work.tenantId,
        identifierType: work.subjectType,
        encryptedValue: work.encryptedValue,
        keyVersion: work.keyVersion,
      });
    } catch {
      await this.recordFailure(
        work,
        startedAt,
        "IDENTIFIER_REVEAL_FAILED",
        true,
        null,
      );
      return "failed";
    }

    let observations: readonly MonitoringObservation[];
    try {
      observations = parseObservations(
        await adapter.collect({
          executionId: work.executionId,
          targetId: work.targetId,
          type: work.subjectType,
          value,
        }),
      );
    } catch (error) {
      const sourceFailure = error instanceof SourceCollectionError ? error : undefined;
      const invalidResponse = error instanceof InvalidSourceResponseError;
      const failureCode = invalidResponse
        ? "SOURCE_INVALID_RESPONSE"
        : sourceFailure && FAILURE_CODE_PATTERN.test(sourceFailure.code)
          ? sourceFailure.code
          : "SOURCE_FAILED";
      const failureNumber = work.consecutiveFailures + 1;
      const terminal =
        invalidResponse ||
        sourceFailure?.retryable === false ||
        failureNumber >= this.config.maxFailures;
      await this.recordFailure(
        work,
        startedAt,
        failureCode,
        terminal,
        terminal ? null : this.nextRetryAt(work, startedAt, failureNumber),
      );
      return "failed";
    }

    await this.repository.complete({
      executionId: work.executionId,
      leaseToken: work.leaseToken,
      completedAt: startedAt,
      nextAttemptAt: new Date(startedAt.getTime() + this.config.successIntervalMs),
      observations,
    });
    this.emitMetric({
      executionId: work.executionId,
      sourceCode: work.sourceCode,
      outcome: "succeeded",
      observationCount: observations.length,
    });
    return "succeeded";
  }

  private nextRetryAt(
    work: ClaimedMonitoringWork,
    startedAt: Date,
    failureNumber: number,
  ): Date {
    const exponential = this.config.baseBackoffMs * 2 ** (failureNumber - 1);
    const capped = Math.min(exponential, this.config.maxBackoffMs);
    const withJitter = capped + Math.floor((capped * deterministicJitter(work.executionId)) / 100);
    return new Date(startedAt.getTime() + Math.min(withJitter, this.config.maxBackoffMs));
  }

  private async recordFailure(
    work: ClaimedMonitoringWork,
    failedAt: Date,
    failureCode: string,
    terminal: boolean,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.repository.fail({
      executionId: work.executionId,
      leaseToken: work.leaseToken,
      failedAt,
      failureCode,
      nextAttemptAt,
      terminal,
    });
    this.emitMetric({
      executionId: work.executionId,
      sourceCode: work.sourceCode,
      outcome: "failed",
      failureCode,
    });
  }

  private emitMetric(metric: WorkerMetric): void {
    try {
      this.recordMetric(metric);
    } catch {
      // Metrics must never change an already persisted execution outcome.
    }
  }
}
