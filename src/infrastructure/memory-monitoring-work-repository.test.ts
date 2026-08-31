import { describe, expect, it } from "vitest";

import {
  MonitoringWorkConflictError,
  MonitoringWorkValidationError,
  type MonitoringObservation,
} from "../application/monitoring-worker.js";
import {
  MemoryMonitoringWorkRepository,
  type MemoryMonitoringWorkSeed,
} from "./memory-monitoring-work-repository.js";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const LATER = new Date("2026-08-30T13:00:00.000Z");
const seed = (
  stateId: string,
  overrides: Partial<MemoryMonitoringWorkSeed> = {},
): MemoryMonitoringWorkSeed => ({
  tenantId: "10000000-0000-8000-8000-000000000001",
  stateId,
  targetId: `70000000-0000-8000-8000-${stateId.slice(-12)}`,
  subjectId: `80000000-0000-8000-8000-${stateId.slice(-12)}`,
  sourceCode: "synthetic",
  subjectType: "name",
  encryptedValue: "aes-256-gcm:v1:synthetic",
  keyVersion: "v1",
  status: "ready",
  nextAttemptAt: NOW,
  consecutiveFailures: 0,
  ...overrides,
});

const observation: MonitoringObservation = {
  externalId: "synthetic-publication-1",
  contentHash: `sha256:${"a".repeat(64)}`,
  parserVersion: "synthetic-parser-v1",
  schemaVersion: 1,
  cnjNumber: "0000001-23.2026.8.99.0001",
  tribunalCode: "TJZZ",
  collectedAt: NOW,
  eventType: "publication",
  externalEventKey: "publication-memory-1",
  occurredAt: new Date("2026-08-30T11:00:00.000Z"),
  title: "Publicação sintética",
  plainTextExcerpt: "Trecho sintético.",
};

const deterministicRepository = (
  seeds: readonly MemoryMonitoringWorkSeed[],
) => {
  let sequence = 0;
  return new MemoryMonitoringWorkRepository(
    seeds,
    () => {
      sequence += 1;
      return `50000000-0000-8000-8000-${String(sequence).padStart(12, "0")}`;
    },
    () => `synthetic-lease-token-${sequence}`,
  );
};

const claimDue = (
  repository: MemoryMonitoringWorkRepository,
  now = NOW,
  limit = 25,
) =>
  repository.claimDue({
    workerId: "worker-local",
    now,
    limit,
    leaseDurationMs: 60_000,
  });

describe("MemoryMonitoringWorkRepository", () => {
  it("claims only due work in stable order and never leases it twice", async () => {
    const repository = deterministicRepository([
      seed("60000000-0000-8000-8000-000000000003", { nextAttemptAt: LATER }),
      seed("60000000-0000-8000-8000-000000000002", { status: "disabled", nextAttemptAt: null }),
      seed("60000000-0000-8000-8000-000000000004", { status: "archived", nextAttemptAt: null }),
      seed("60000000-0000-8000-8000-000000000001"),
      seed("60000000-0000-8000-8000-000000000005", { status: "backoff" }),
    ]);

    const first = await claimDue(repository, NOW, 1);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      stateId: "60000000-0000-8000-8000-000000000001",
      executionId: "50000000-0000-8000-8000-000000000001",
      leaseToken: "synthetic-lease-token-1",
    });
    const second = await claimDue(repository, NOW, 25);
    expect(second.map((item) => item.stateId)).toEqual([
      "60000000-0000-8000-8000-000000000005",
    ]);
    await expect(claimDue(repository)).resolves.toEqual([]);
    expect(repository.inspectState(first[0]!.stateId)).toMatchObject({
      status: "running",
      activeExecutionId: first[0]!.executionId,
    });
  });

  it("completes exactly once and stores only deduplicated evidence metadata", async () => {
    const repository = deterministicRepository([
      seed("60000000-0000-8000-8000-000000000001", { consecutiveFailures: 2 }),
    ]);
    const work = (await claimDue(repository))[0]!;
    const command = {
      executionId: work.executionId,
      leaseToken: work.leaseToken,
      completedAt: NOW,
      nextAttemptAt: LATER,
      observations: [observation, observation],
    };

    await repository.complete(command);
    await repository.complete(command);
    expect(repository.inspectState(work.stateId)).toEqual({
      status: "ready",
      nextAttemptAt: LATER,
      consecutiveFailures: 0,
      activeExecutionId: null,
      observationCount: 1,
    });
    expect(repository.inspectExecution(work.executionId)).toBe("completed");
    expect(repository.inspectEvidence(work.tenantId)).toEqual({
      envelopeCount: 1,
      observationCount: 1,
      caseCount: 1,
      externalReferenceCount: 1,
      tenantCaseCount: 1,
    });
    expect(JSON.stringify(repository.inspectState(work.stateId))).not.toContain(
      "aes-256-gcm",
    );

    await expect(
      repository.complete({ ...command, nextAttemptAt: new Date(LATER.getTime() + 1) }),
    ).rejects.toBeInstanceOf(MonitoringWorkConflictError);
  });

  it("reuses an envelope and case while preserving a new parser observation", async () => {
    const repository = deterministicRepository([
      seed("60000000-0000-8000-8000-000000000001"),
    ]);
    const first = (await claimDue(repository))[0]!;
    await repository.complete({
      executionId: first.executionId,
      leaseToken: first.leaseToken,
      completedAt: NOW,
      nextAttemptAt: LATER,
      observations: [observation],
    });
    const second = (await claimDue(repository, LATER))[0]!;
    await repository.complete({
      executionId: second.executionId,
      leaseToken: second.leaseToken,
      completedAt: LATER,
      nextAttemptAt: new Date(LATER.getTime() + 300_000),
      observations: [{ ...observation, parserVersion: "synthetic-parser-v2" }],
    });

    expect(repository.inspectEvidence(first.tenantId)).toEqual({
      envelopeCount: 1,
      observationCount: 2,
      caseCount: 1,
      externalReferenceCount: 1,
      tenantCaseCount: 1,
    });
  });

  it("records retryable and terminal failures idempotently", async () => {
    const repository = deterministicRepository([
      seed("60000000-0000-8000-8000-000000000001"),
    ]);
    const first = (await claimDue(repository))[0]!;
    const retryAt = new Date(NOW.getTime() + 300_000);
    const retry = {
      executionId: first.executionId,
      leaseToken: first.leaseToken,
      failedAt: NOW,
      failureCode: "SOURCE_TIMEOUT",
      nextAttemptAt: retryAt,
      terminal: false,
    };

    await repository.fail(retry);
    await repository.fail(retry);
    expect(repository.inspectState(first.stateId)).toMatchObject({
      status: "backoff",
      nextAttemptAt: retryAt,
      consecutiveFailures: 1,
    });
    await expect(claimDue(repository, new Date(retryAt.getTime() - 1))).resolves.toEqual([]);

    const second = (await claimDue(repository, retryAt))[0]!;
    await repository.fail({
      executionId: second.executionId,
      leaseToken: second.leaseToken,
      failedAt: retryAt,
      failureCode: "SOURCE_REJECTED",
      nextAttemptAt: null,
      terminal: true,
    });
    expect(repository.inspectState(second.stateId)).toMatchObject({
      status: "disabled",
      nextAttemptAt: null,
      consecutiveFailures: 2,
    });
    expect(repository.inspectExecution(second.executionId)).toBe("failed");
  });

  it("expires stale leases and rejects acknowledgements from their old owner", async () => {
    const repository = deterministicRepository([
      seed("60000000-0000-8000-8000-000000000001"),
    ]);
    const first = (await claimDue(repository))[0]!;
    await expect(
      claimDue(repository, new Date(NOW.getTime() + 59_999)),
    ).resolves.toEqual([]);

    const reclaimedAt = new Date(NOW.getTime() + 60_000);
    const second = (await claimDue(repository, reclaimedAt))[0]!;
    expect(second.executionId).not.toBe(first.executionId);
    expect(repository.inspectExecution(first.executionId)).toBe("expired");
    await expect(
      repository.complete({
        executionId: first.executionId,
        leaseToken: first.leaseToken,
        completedAt: reclaimedAt,
        nextAttemptAt: LATER,
        observations: [],
      }),
    ).rejects.toBeInstanceOf(MonitoringWorkConflictError);

    await repository.complete({
      executionId: second.executionId,
      leaseToken: second.leaseToken,
      completedAt: reclaimedAt,
      nextAttemptAt: LATER,
      observations: [],
    });
    expect(repository.inspectExecution(second.executionId)).toBe("completed");
  });

  it("fails closed for unknown executions, wrong leases and incompatible outcomes", async () => {
    const repository = deterministicRepository([
      seed("60000000-0000-8000-8000-000000000001"),
      seed("60000000-0000-8000-8000-000000000002"),
    ]);
    const [first, second] = await claimDue(repository);
    const complete = {
      executionId: first!.executionId,
      leaseToken: first!.leaseToken,
      completedAt: NOW,
      nextAttemptAt: LATER,
      observations: [],
    };
    await repository.complete(complete);

    await expect(
      repository.fail({
        executionId: first!.executionId,
        leaseToken: first!.leaseToken,
        failedAt: NOW,
        failureCode: "SOURCE_FAILED",
        nextAttemptAt: LATER,
        terminal: false,
      }),
    ).rejects.toBeInstanceOf(MonitoringWorkConflictError);
    await expect(
      repository.complete({ ...complete, executionId: "missing" }),
    ).rejects.toBeInstanceOf(MonitoringWorkConflictError);
    await expect(
      repository.complete({
        ...complete,
        executionId: second!.executionId,
        leaseToken: "wrong-synthetic-token",
      }),
    ).rejects.toBeInstanceOf(MonitoringWorkConflictError);
  });

  it.each([
    ["empty worker", { workerId: "" }],
    ["long worker", { workerId: "A".repeat(101) }],
    ["invalid now", { now: new Date("invalid") }],
    ["small limit", { limit: 0 }],
    ["large limit", { limit: 26 }],
    ["fractional limit", { limit: 1.5 }],
    ["short lease", { leaseDurationMs: 29_999 }],
    ["long lease", { leaseDurationMs: 900_001 }],
    ["fractional lease", { leaseDurationMs: 60_000.5 }],
  ])("rejects an invalid claim command: %s", async (_name, override) => {
    const repository = deterministicRepository([]);
    await expect(
      repository.claimDue({
        workerId: "worker-local",
        now: NOW,
        limit: 25,
        leaseDurationMs: 60_000,
        ...override,
      }),
    ).rejects.toBeInstanceOf(MonitoringWorkValidationError);
  });

  it("rejects malformed acknowledgements and duplicate seeds/generator collisions", async () => {
    const state = seed("60000000-0000-8000-8000-000000000001");
    expect(
      () => deterministicRepository([state, state]),
    ).toThrow(MonitoringWorkConflictError);

    const repository = deterministicRepository([state]);
    const work = (await claimDue(repository))[0]!;
    await expect(
      repository.fail({
        executionId: work.executionId,
        leaseToken: work.leaseToken,
        failedAt: new Date("invalid"),
        failureCode: "invalid code",
        nextAttemptAt: null,
        terminal: false,
      }),
    ).rejects.toBeInstanceOf(MonitoringWorkValidationError);
    await expect(
      repository.complete({
        executionId: work.executionId,
        leaseToken: "",
        completedAt: NOW,
        nextAttemptAt: NOW,
        observations: [],
      }),
    ).rejects.toBeInstanceOf(MonitoringWorkValidationError);

    const collision = new MemoryMonitoringWorkRepository(
      [state, seed("60000000-0000-8000-8000-000000000002")],
      () => "same-execution",
      () => "valid-lease-token",
    );
    await claimDue(collision, NOW, 1);
    await expect(claimDue(collision, NOW, 1)).rejects.toBeInstanceOf(
      MonitoringWorkConflictError,
    );
  });

  it("supports secure random execution and lease defaults", async () => {
    const repository = new MemoryMonitoringWorkRepository([
      seed("60000000-0000-8000-8000-000000000001"),
    ]);
    const work = (await claimDue(repository))[0]!;
    expect(work.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(work.leaseToken.length).toBeGreaterThan(20);
  });
});
