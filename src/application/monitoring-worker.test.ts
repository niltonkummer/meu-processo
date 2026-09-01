import { describe, expect, it, vi } from "vitest";

import type { IdentifierProtector } from "./protected-subject-factory.js";
import {
  MonitoringWorker,
  MonitoringWorkerConfigurationError,
  SourceCollectionError,
  type ClaimedMonitoringWork,
  type MonitoringSourceAdapter,
  type MonitoringWorkRepository,
  type WorkerMetric,
} from "./monitoring-worker.js";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const claim = (overrides: Partial<ClaimedMonitoringWork> = {}) => ({
  executionId: "50000000-0000-8000-8000-000000000001",
  leaseToken: "synthetic-lease-token",
  tenantId: "10000000-0000-8000-8000-000000000001",
  stateId: "60000000-0000-8000-8000-000000000001",
  targetId: "70000000-0000-8000-8000-000000000001",
  subjectId: "80000000-0000-8000-8000-000000000001",
  sourceCode: "synthetic",
  subjectType: "name" as const,
  encryptedValue: "encrypted-only",
  keyVersion: "v1",
  consecutiveFailures: 0,
  ...overrides,
});

const observation = {
  externalId: "synthetic-publication-1",
  contentHash: `sha256:${"a".repeat(64)}`,
  parserVersion: "synthetic-parser-v1",
  schemaVersion: 1 as const,
  cnjNumber: "0000001-23.2026.8.99.0001",
  tribunalCode: "TJZZ",
  collectedAt: NOW,
  eventType: "publication" as const,
  externalEventKey: "publication-1",
  occurredAt: new Date("2026-08-30T11:00:00.000Z"),
  title: "Intimação publicada",
  plainTextExcerpt: "Trecho seguro & decodificado.",
};

const setup = (input: {
  claims?: readonly ClaimedMonitoringWork[];
  enabled?: boolean;
  adapter?: MonitoringSourceAdapter;
  protector?: IdentifierProtector;
} = {}) => {
  const repository = {
    claimDue: vi
      .fn<MonitoringWorkRepository["claimDue"]>()
      .mockResolvedValue(input.claims ?? [claim()]),
    complete: vi
      .fn<MonitoringWorkRepository["complete"]>()
      .mockResolvedValue(undefined),
    fail: vi.fn<MonitoringWorkRepository["fail"]>().mockResolvedValue(undefined),
  } satisfies MonitoringWorkRepository;
  const adapter =
    input.adapter ??
    ({
      sourceCode: "synthetic",
      collect: vi.fn().mockResolvedValue([observation]),
    } satisfies MonitoringSourceAdapter);
  const protector =
    input.protector ??
    ({
      protect: vi.fn(),
      reveal: vi.fn().mockReturnValue("Pessoa Sintética"),
    } satisfies IdentifierProtector);
  const metrics: WorkerMetric[] = [];
  const worker = new MonitoringWorker(
    repository,
    protector,
    {
      resolve: (sourceCode) =>
        sourceCode === adapter.sourceCode && input.enabled !== false
          ? adapter
          : undefined,
    },
    (metric) => metrics.push(metric),
    {
      workerId: "local-worker",
      batchSize: 25,
      leaseDurationMs: 60_000,
      successIntervalMs: 86_400_000,
      baseBackoffMs: 300_000,
      maxBackoffMs: 86_400_000,
      maxFailures: 5,
    },
    () => NOW,
  );
  return { worker, repository, adapter, protector, metrics };
};

describe("MonitoringWorker", () => {
  it("reveals only in memory, collects and completes with minimized evidence", async () => {
    const { worker, repository, adapter, protector, metrics } = setup();

    await expect(worker.runTick()).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(repository.claimDue).toHaveBeenCalledWith({
      workerId: "local-worker",
      now: NOW,
      limit: 25,
      leaseDurationMs: 60_000,
    });
    expect(protector.reveal).toHaveBeenCalledWith({
      tenantId: claim().tenantId,
      identifierType: "name",
      encryptedValue: "encrypted-only",
      keyVersion: "v1",
    });
    expect(adapter.collect).toHaveBeenCalledWith({
      executionId: claim().executionId,
      targetId: claim().targetId,
      type: "name",
      value: "Pessoa Sintética",
    });
    expect(repository.complete).toHaveBeenCalledWith({
      executionId: claim().executionId,
      leaseToken: claim().leaseToken,
      completedAt: NOW,
      nextAttemptAt: new Date("2026-08-31T12:00:00.000Z"),
      observations: [observation],
    });
    expect(repository.fail).not.toHaveBeenCalled();
    expect(JSON.stringify([repository.complete.mock.calls, metrics])).not.toContain(
      "Pessoa Sintética",
    );
    expect(metrics).toEqual([
      {
        executionId: claim().executionId,
        sourceCode: "synthetic",
        outcome: "succeeded",
        observationCount: 1,
      },
    ]);
  });

  it("deduplicates identical source observations before metrics and persistence", async () => {
    const adapter = {
      sourceCode: "synthetic",
      collect: vi.fn().mockResolvedValue([observation, { ...observation }]),
    } satisfies MonitoringSourceAdapter;
    const { worker, repository, metrics } = setup({ adapter });

    await expect(worker.runTick()).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(repository.complete.mock.calls[0]![0].observations).toEqual([
      observation,
    ]);
    expect(metrics[0]).toMatchObject({ observationCount: 1 });
  });

  it("does not reveal or call a disabled or unknown source", async () => {
    const { worker, repository, adapter, protector, metrics } = setup({ enabled: false });

    await expect(worker.runTick()).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(protector.reveal).not.toHaveBeenCalled();
    expect(adapter.collect).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith({
      executionId: claim().executionId,
      leaseToken: claim().leaseToken,
      failedAt: NOW,
      failureCode: "SOURCE_DISABLED",
      nextAttemptAt: null,
      terminal: true,
    });
    expect(metrics[0]).toMatchObject({ outcome: "failed", failureCode: "SOURCE_DISABLED" });
  });

  it("treats reveal failure as terminal and never calls the source", async () => {
    const protector = {
      protect: vi.fn(),
      reveal: vi.fn(() => {
        throw new Error("must not escape");
      }),
    } satisfies IdentifierProtector;
    const { worker, repository, adapter, metrics } = setup({ protector });

    await expect(worker.runTick()).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(adapter.collect).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "IDENTIFIER_REVEAL_FAILED",
        nextAttemptAt: null,
        terminal: true,
      }),
    );
    expect(JSON.stringify(metrics)).not.toContain("must not escape");
  });

  it("backs off retryable failures without exposing source messages", async () => {
    const adapter = {
      sourceCode: "synthetic",
      collect: vi.fn(() => {
        throw new SourceCollectionError("SOURCE_TIMEOUT", true);
      }),
    } satisfies MonitoringSourceAdapter;
    const { worker, repository, metrics } = setup({
      adapter,
      claims: [claim({ consecutiveFailures: 1 })],
    });

    await expect(worker.runTick()).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    const failure = repository.fail.mock.calls[0]![0];
    expect(failure).toMatchObject({
      failureCode: "SOURCE_TIMEOUT",
      terminal: false,
    });
    expect(failure.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + 600_000,
    );
    expect(failure.nextAttemptAt!.getTime()).toBeLessThanOrEqual(
      NOW.getTime() + 720_000,
    );
    expect(metrics[0]).toMatchObject({ failureCode: "SOURCE_TIMEOUT" });
  });

  it("stops retrying permanent, unknown and exhausted failures", async () => {
    const errors = [
      new SourceCollectionError("SOURCE_REJECTED", false),
      new Error("unknown detail"),
      new SourceCollectionError("SOURCE_TIMEOUT", true),
      new SourceCollectionError("INVALID\nPessoa Sintética", true),
    ];
    const adapter = {
      sourceCode: "synthetic",
      collect: vi.fn(() => {
        throw errors.shift()!;
      }),
    } satisfies MonitoringSourceAdapter;
    const claims = [
      claim(),
      claim({ executionId: "50000000-0000-8000-8000-000000000002" }),
      claim({
        executionId: "50000000-0000-8000-8000-000000000003",
        consecutiveFailures: 4,
      }),
      claim({ executionId: "50000000-0000-8000-8000-000000000004" }),
    ];
    const { worker, repository } = setup({ adapter, claims });

    await expect(worker.runTick()).resolves.toEqual({ claimed: 4, succeeded: 0, failed: 4 });
    expect(repository.fail.mock.calls.map(([value]) => value)).toEqual([
      expect.objectContaining({ failureCode: "SOURCE_REJECTED", terminal: true, nextAttemptAt: null }),
      expect.objectContaining({ failureCode: "SOURCE_FAILED", terminal: false }),
      expect.objectContaining({ failureCode: "SOURCE_TIMEOUT", terminal: true, nextAttemptAt: null }),
      expect.objectContaining({ failureCode: "SOURCE_FAILED", terminal: false }),
    ]);
  });

  it.each([
    ["non-array", "invalid"],
    ["too many", Array.from({ length: 1_001 }, () => observation)],
    ["primitive", ["invalid"]],
    ["extra field", [{ ...observation, plaintext: "Pessoa Sintética" }]],
    ["missing field", [{ ...observation, parserVersion: undefined }]],
    ["empty id", [{ ...observation, externalId: "" }]],
    ["long id", [{ ...observation, externalId: "A".repeat(256) }]],
    ["invalid hash", [{ ...observation, contentHash: "sha256:invalid" }]],
    ["non-string parser", [{ ...observation, parserVersion: 12 }]],
    ["empty parser", [{ ...observation, parserVersion: "" }]],
    ["long parser", [{ ...observation, parserVersion: "A".repeat(101) }]],
    ["invalid schema", [{ ...observation, schemaVersion: 2 }]],
    ["invalid CNJ", [{ ...observation, cnjNumber: "00000012320268990001" }]],
    ["invalid tribunal", [{ ...observation, tribunalCode: "tj zz" }]],
    [
      "conflicting duplicate parser",
      [observation, { ...observation, parserVersion: "synthetic-parser-v2" }],
    ],
    [
      "conflicting duplicate CNJ",
      [observation, { ...observation, cnjNumber: "0000002-23.2026.8.99.0001" }],
    ],
    [
      "conflicting duplicate tribunal",
      [observation, { ...observation, tribunalCode: "TRF1" }],
    ],
    [
      "conflicting duplicate collection time",
      [observation, { ...observation, collectedAt: new Date(NOW.getTime() + 1) }],
    ],
    ["non-date", [{ ...observation, collectedAt: "2026-08-30" }]],
    ["invalid date", [{ ...observation, collectedAt: new Date("invalid") }]],
    ["invalid event type", [{ ...observation, eventType: "movement" }]],
    ["non-string event key", [{ ...observation, externalEventKey: 1 }]],
    ["empty event key", [{ ...observation, externalEventKey: "" }]],
    ["long event key", [{ ...observation, externalEventKey: "A".repeat(256) }]],
    ["non-date occurrence", [{ ...observation, occurredAt: "2026-08-30" }]],
    ["invalid occurrence", [{ ...observation, occurredAt: new Date("invalid") }]],
    ["occurrence after collection", [{ ...observation, occurredAt: new Date(NOW.getTime() + 1) }]],
    ["non-string title", [{ ...observation, title: 1 }]],
    ["empty title", [{ ...observation, title: "" }]],
    ["long title", [{ ...observation, title: "A".repeat(201) }]],
    ["unsafe title", [{ ...observation, title: "Unsafe\u0000title" }]],
    ["non-string excerpt", [{ ...observation, plainTextExcerpt: 1 }]],
    ["long excerpt", [{ ...observation, plainTextExcerpt: "A".repeat(501) }]],
    ["unsafe excerpt", [{ ...observation, plainTextExcerpt: "Unsafe\u0000excerpt" }]],
    ["conflicting event key", [observation, { ...observation, externalEventKey: "publication-2" }]],
    ["conflicting occurrence", [observation, { ...observation, occurredAt: new Date("2026-08-30T10:00:00Z") }]],
    ["conflicting title", [observation, { ...observation, title: "Outro título" }]],
    ["conflicting excerpt", [observation, { ...observation, plainTextExcerpt: null }]],
  ])("rejects unsafe source observations: %s", async (_name, sourceResult) => {
    const adapter = {
      sourceCode: "synthetic",
      collect: vi.fn().mockResolvedValue(sourceResult),
    } as unknown as MonitoringSourceAdapter;
    const { worker, repository } = setup({ adapter });

    await expect(worker.runTick()).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "SOURCE_INVALID_RESPONSE",
        terminal: true,
        nextAttemptAt: null,
      }),
    );
    expect(JSON.stringify(repository.fail.mock.calls)).not.toContain("Pessoa Sintética");
  });

  it("does not let a metrics backend break completed work", async () => {
    const base = setup();
    const worker = new MonitoringWorker(
      base.repository,
      base.protector,
      { resolve: () => base.adapter },
      () => {
        throw new Error("metrics unavailable");
      },
      {
        workerId: "local-worker",
        batchSize: 25,
        leaseDurationMs: 60_000,
        successIntervalMs: 86_400_000,
        baseBackoffMs: 300_000,
        maxBackoffMs: 86_400_000,
        maxFailures: 5,
      },
      () => NOW,
    );

    await expect(worker.runTick()).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 0 });
  });

  it("returns an empty summary and lets claim/ack infrastructure failures preserve the lease", async () => {
    const empty = setup({ claims: [] });
    await expect(empty.worker.runTick()).resolves.toEqual({ claimed: 0, succeeded: 0, failed: 0 });

    const claimFailure = setup();
    claimFailure.repository.claimDue.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(claimFailure.worker.runTick()).rejects.toThrow("database unavailable");

    const ackFailure = setup();
    ackFailure.repository.complete.mockRejectedValueOnce(new Error("ack unavailable"));
    await expect(ackFailure.worker.runTick()).rejects.toThrow("ack unavailable");
    expect(ackFailure.repository.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["missing reveal", { protect: vi.fn() } satisfies IdentifierProtector, {}],
    ["invalid batch", undefined, { batchSize: 0 }],
    ["invalid lease", undefined, { leaseDurationMs: 1 }],
    ["invalid success interval", undefined, { successIntervalMs: 1 }],
    ["invalid base backoff", undefined, { baseBackoffMs: 1 }],
    ["invalid max backoff", undefined, { maxBackoffMs: 1 }],
    ["invalid failure limit", undefined, { maxFailures: 0 }],
    ["invalid worker id", undefined, { workerId: "" }],
  ])("rejects unsafe configuration: %s", (_name, protectorOverride, configOverride) => {
    const base = setup();
    expect(
      () =>
        new MonitoringWorker(
          base.repository,
          protectorOverride ?? base.protector,
          { resolve: () => base.adapter },
          () => undefined,
          {
            workerId: "local-worker",
            batchSize: 25,
            leaseDurationMs: 60_000,
            successIntervalMs: 86_400_000,
            baseBackoffMs: 300_000,
            maxBackoffMs: 86_400_000,
            maxFailures: 5,
            ...configOverride,
          },
          () => NOW,
        ),
    ).toThrow(MonitoringWorkerConfigurationError);
  });
});
