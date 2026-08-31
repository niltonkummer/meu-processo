import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  ClaimedMonitoringWork,
  MonitoringObservation,
  MonitoringWorkRepository,
} from "../application/monitoring-worker.js";
import {
  MonitoringWorkConflictError,
  MonitoringWorkValidationError,
} from "../application/monitoring-worker.js";
import type { SubjectType } from "../application/foundation-repository.js";

export type MemoryMonitoringWorkStatus =
  | "ready"
  | "running"
  | "backoff"
  | "disabled"
  | "archived";

export interface MemoryMonitoringWorkSeed {
  readonly tenantId: string;
  readonly stateId: string;
  readonly targetId: string;
  readonly subjectId: string;
  readonly sourceCode: string;
  readonly subjectType: SubjectType;
  readonly encryptedValue: string;
  readonly keyVersion: string;
  readonly status: Exclude<MemoryMonitoringWorkStatus, "running">;
  readonly nextAttemptAt: Date | null;
  readonly consecutiveFailures: number;
}

type StoredWork = Omit<
  MemoryMonitoringWorkSeed,
  "status" | "nextAttemptAt" | "consecutiveFailures"
> & {
  status: MemoryMonitoringWorkStatus;
  nextAttemptAt: Date | null;
  consecutiveFailures: number;
  activeExecutionId: string | null;
  readonly observations: Map<string, MonitoringObservation>;
};

interface StoredExecution {
  readonly executionId: string;
  readonly stateId: string;
  readonly leaseTokenHash: Buffer;
  readonly leasedUntil: Date;
  status: "running" | "completed" | "failed" | "expired";
  outcomeFingerprint: string | null;
}

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());
const validObservation = (value: MonitoringObservation): boolean =>
  value.externalId.length >= 1 &&
  value.externalId.length <= 255 &&
  /^sha256:[a-f0-9]{64}$/.test(value.contentHash) &&
  value.parserVersion.length >= 1 &&
  value.parserVersion.length <= 100 &&
  value.schemaVersion === 1 &&
  /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(value.cnjNumber) &&
  /^[A-Z][A-Z0-9-]{1,19}$/.test(value.tribunalCode) &&
  validDate(value.collectedAt);
const sameToken = (token: string, expected: Buffer): boolean =>
  timingSafeEqual(sha256(token), expected);

export class MemoryMonitoringWorkRepository implements MonitoringWorkRepository {
  private readonly work = new Map<string, StoredWork>();
  private readonly executions = new Map<string, StoredExecution>();
  private envelopes = new Set<string>();
  private canonicalObservations = new Map<string, MonitoringObservation>();
  private cases = new Map<string, string>();
  private externalReferences = new Map<string, string>();
  private tenantCases = new Set<string>();

  constructor(
    seeds: readonly MemoryMonitoringWorkSeed[] = [],
    private readonly createExecutionId: () => string = randomUUID,
    private readonly createLeaseToken: () => string = () =>
      randomBytes(32).toString("base64url"),
  ) {
    for (const seed of seeds) {
      if (this.work.has(seed.stateId)) throw new MonitoringWorkConflictError();
      this.work.set(seed.stateId, {
        ...seed,
        nextAttemptAt: seed.nextAttemptAt
          ? new Date(seed.nextAttemptAt)
          : null,
        activeExecutionId: null,
        observations: new Map(),
      });
    }
  }

  async claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedMonitoringWork[]> {
    await Promise.resolve();
    if (
      input.workerId.length < 1 ||
      input.workerId.length > 100 ||
      !validDate(input.now) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 25 ||
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 30_000 ||
      input.leaseDurationMs > 900_000
    ) {
      throw new MonitoringWorkValidationError();
    }

    this.expireLeases(input.now);
    const due = [...this.work.values()]
      .filter(
        (item) =>
          (item.status === "ready" || item.status === "backoff") &&
          item.activeExecutionId === null &&
          item.nextAttemptAt !== null &&
          item.nextAttemptAt.getTime() <= input.now.getTime(),
      )
      .sort((left, right) => {
        const time = left.nextAttemptAt!.getTime() - right.nextAttemptAt!.getTime();
        return time === 0 ? left.stateId.localeCompare(right.stateId) : time;
      })
      .slice(0, input.limit);

    const claims = due.map((item): ClaimedMonitoringWork => {
      const executionId = this.createExecutionId();
      const leaseToken = this.createLeaseToken();
      if (
        executionId.length < 1 ||
        leaseToken.length < 16 ||
        this.executions.has(executionId)
      ) {
        throw new MonitoringWorkConflictError();
      }
      item.status = "running";
      item.activeExecutionId = executionId;
      this.executions.set(executionId, {
        executionId,
        stateId: item.stateId,
        leaseTokenHash: sha256(leaseToken),
        leasedUntil: new Date(input.now.getTime() + input.leaseDurationMs),
        status: "running",
        outcomeFingerprint: null,
      });
      return {
        executionId,
        leaseToken,
        tenantId: item.tenantId,
        stateId: item.stateId,
        targetId: item.targetId,
        subjectId: item.subjectId,
        sourceCode: item.sourceCode,
        subjectType: item.subjectType,
        encryptedValue: item.encryptedValue,
        keyVersion: item.keyVersion,
        consecutiveFailures: item.consecutiveFailures,
      };
    });
    return claims;
  }

  async complete(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
    readonly nextAttemptAt: Date;
    readonly observations: readonly MonitoringObservation[];
  }): Promise<void> {
    await Promise.resolve();
    if (
      input.executionId.length < 1 ||
      input.leaseToken.length < 16 ||
      !validDate(input.completedAt) ||
      !validDate(input.nextAttemptAt) ||
      input.nextAttemptAt.getTime() <= input.completedAt.getTime() ||
      input.observations.length > 1_000 ||
      input.observations.some((item) => !validObservation(item))
    ) {
      throw new MonitoringWorkValidationError();
    }
    const outcome = fingerprint({
      kind: "complete",
      completedAt: input.completedAt.toISOString(),
      nextAttemptAt: input.nextAttemptAt.toISOString(),
      observations: input.observations.map((item) => ({
        ...item,
        collectedAt: item.collectedAt.toISOString(),
      })),
    });
    const execution = this.executionForOutcome(
      input.executionId,
      input.leaseToken,
      "completed",
      outcome,
      input.completedAt,
    );
    if (execution.status === "completed") return;
    const state = this.activeState(execution);
    this.persistEvidence(state, input.observations);
    for (const item of input.observations) {
      state.observations.set(
        `${item.externalId}\0${item.contentHash}\0${item.parserVersion}\0${item.schemaVersion}`,
        {
        ...item,
        collectedAt: new Date(item.collectedAt),
        },
      );
    }
    state.status = "ready";
    state.nextAttemptAt = new Date(input.nextAttemptAt);
    state.consecutiveFailures = 0;
    state.activeExecutionId = null;
    execution.status = "completed";
    execution.outcomeFingerprint = outcome;
  }

  async fail(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void> {
    await Promise.resolve();
    if (
      input.executionId.length < 1 ||
      input.leaseToken.length < 16 ||
      !validDate(input.failedAt) ||
      !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.failureCode) ||
      (input.terminal && input.nextAttemptAt !== null) ||
      (!input.terminal &&
        (input.nextAttemptAt === null ||
          !validDate(input.nextAttemptAt) ||
          input.nextAttemptAt.getTime() <= input.failedAt.getTime()))
    ) {
      throw new MonitoringWorkValidationError();
    }
    const outcome = fingerprint({
      kind: "fail",
      failedAt: input.failedAt.toISOString(),
      failureCode: input.failureCode,
      nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
      terminal: input.terminal,
    });
    const execution = this.executionForOutcome(
      input.executionId,
      input.leaseToken,
      "failed",
      outcome,
      input.failedAt,
    );
    if (execution.status === "failed") return;
    const state = this.activeState(execution);
    state.status = input.terminal ? "disabled" : "backoff";
    state.nextAttemptAt = input.nextAttemptAt
      ? new Date(input.nextAttemptAt)
      : null;
    state.consecutiveFailures += 1;
    state.activeExecutionId = null;
    execution.status = "failed";
    execution.outcomeFingerprint = outcome;
  }

  inspectState(stateId: string): {
    readonly status: MemoryMonitoringWorkStatus;
    readonly nextAttemptAt: Date | null;
    readonly consecutiveFailures: number;
    readonly activeExecutionId: string | null;
    readonly observationCount: number;
  } | null {
    const item = this.work.get(stateId);
    return item
      ? {
          status: item.status,
          nextAttemptAt: item.nextAttemptAt
            ? new Date(item.nextAttemptAt)
            : null,
          consecutiveFailures: item.consecutiveFailures,
          activeExecutionId: item.activeExecutionId,
          observationCount: item.observations.size,
        }
      : null;
  }

  inspectExecution(
    executionId: string,
  ): StoredExecution["status"] | null {
    return this.executions.get(executionId)?.status ?? null;
  }

  inspectEvidence(tenantId: string): {
    readonly envelopeCount: number;
    readonly observationCount: number;
    readonly caseCount: number;
    readonly externalReferenceCount: number;
    readonly tenantCaseCount: number;
  } {
    const prefix = `${tenantId}\0`;
    return {
      envelopeCount: [...this.envelopes].filter((key) => key.startsWith(prefix)).length,
      observationCount: [...this.canonicalObservations].filter(([key]) =>
        key.startsWith(prefix),
      ).length,
      caseCount: [...this.cases].filter(([key]) => key.startsWith(prefix)).length,
      externalReferenceCount: [...this.externalReferences].filter(([key]) =>
        key.startsWith(prefix),
      ).length,
      tenantCaseCount: [...this.tenantCases].filter((key) => key.startsWith(prefix)).length,
    };
  }

  private persistEvidence(
    state: StoredWork,
    observations: readonly MonitoringObservation[],
  ): void {
    const envelopes = new Set(this.envelopes);
    const canonicalObservations = new Map(this.canonicalObservations);
    const cases = new Map(this.cases);
    const externalReferences = new Map(this.externalReferences);
    const tenantCases = new Set(this.tenantCases);

    for (const item of observations) {
      const envelopeKey = [
        state.tenantId,
        state.sourceCode,
        item.externalId,
        item.contentHash,
      ].join("\0");
      const observationKey = [
        envelopeKey,
        item.parserVersion,
        item.schemaVersion,
      ].join("\0");
      const caseKey = `${state.tenantId}\0${item.cnjNumber}`;
      const referenceKey = `${state.tenantId}\0${state.sourceCode}\0${item.cnjNumber}`;
      const existingObservation = canonicalObservations.get(observationKey);
      const existingTribunal = cases.get(caseKey);
      const existingReference = externalReferences.get(referenceKey);
      if (
        (existingObservation &&
          (existingObservation.cnjNumber !== item.cnjNumber ||
            existingObservation.tribunalCode !== item.tribunalCode)) ||
        (existingTribunal && existingTribunal !== item.tribunalCode) ||
        (existingReference && existingReference !== caseKey)
      ) {
        throw new MonitoringWorkConflictError();
      }
      envelopes.add(envelopeKey);
      canonicalObservations.set(observationKey, {
        ...item,
        collectedAt: new Date(item.collectedAt),
      });
      cases.set(caseKey, item.tribunalCode);
      externalReferences.set(referenceKey, caseKey);
      tenantCases.add(caseKey);
    }

    this.envelopes = envelopes;
    this.canonicalObservations = canonicalObservations;
    this.cases = cases;
    this.externalReferences = externalReferences;
    this.tenantCases = tenantCases;
  }

  private expireLeases(now: Date): void {
    for (const execution of this.executions.values()) {
      if (
        execution.status === "running" &&
        execution.leasedUntil.getTime() <= now.getTime()
      ) {
        execution.status = "expired";
        const state = this.work.get(execution.stateId);
        if (state?.activeExecutionId === execution.executionId) {
          state.status = "ready";
          state.activeExecutionId = null;
        }
      }
    }
  }

  private executionForOutcome(
    executionId: string,
    leaseToken: string,
    expectedCompletedStatus: "completed" | "failed",
    outcomeFingerprint: string,
    outcomeAt: Date,
  ): StoredExecution {
    const execution = this.executions.get(executionId);
    if (!execution || !sameToken(leaseToken, execution.leaseTokenHash)) {
      throw new MonitoringWorkConflictError();
    }
    if (execution.status === expectedCompletedStatus) {
      if (execution.outcomeFingerprint !== outcomeFingerprint) {
        throw new MonitoringWorkConflictError();
      }
      return execution;
    }
    if (
      execution.status !== "running" ||
      outcomeAt.getTime() >= execution.leasedUntil.getTime()
    ) {
      throw new MonitoringWorkConflictError();
    }
    return execution;
  }

  private activeState(execution: StoredExecution): StoredWork {
    const state = this.work.get(execution.stateId);
    if (!state || state.activeExecutionId !== execution.executionId) {
      throw new MonitoringWorkConflictError();
    }
    return state;
  }
}
