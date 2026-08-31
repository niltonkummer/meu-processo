import { describe, expect, it, vi } from "vitest";

import type { IdentifierProtector } from "./protected-subject-factory.js";
import {
  TenantDataLifecycleWorker,
  TenantDataLifecycleWorkerConfigurationError,
  type TenantDataLifecycleWorkerRepository,
  type TenantLifecycleObjectStore,
} from "./tenant-data-lifecycle-worker.js";

const TENANT = "10000000-0000-7000-8000-000000000001";
const REQUEST = "20000000-0000-7000-8000-000000000001";
const ARTIFACT = "30000000-0000-8000-8000-000000000001";
const NOW = new Date("2026-08-31T14:00:00.000Z");
const exportClaim = {
  requestId: REQUEST,
  tenantId: TENANT,
  requestType: "export" as const,
  attemptCount: 1,
  leaseToken: "synthetic-lifecycle-lease-token",
};
const deletionClaim = { ...exportClaim, requestType: "deletion" as const };

const snapshot = () => ({
  schemaVersion: 1,
  generatedAt: NOW.toISOString(),
  tenant: {
    tenantId: TENANT,
    kind: "personal",
    createdAt: "2026-08-30T10:00:00.000Z",
    membershipRole: "owner",
    membershipCreatedAt: "2026-08-30T10:00:00.000Z",
  },
  protectedSubjects: [{
    subjectId: "40000000-0000-7000-8000-000000000001",
    subjectType: "name",
    encryptedValue: "aes-256-gcm:v1:synthetic",
    keyVersion: "v1",
    status: "active",
    createdAt: "2026-08-30T10:01:00.000Z",
    archivedAt: null,
  }],
  monitoringTargets: [{
    targetId: "50000000-0000-7000-8000-000000000001",
    targetType: "name",
    jurisdiction: "BR",
    status: "active",
    nextCheckAt: null,
    createdAt: "2026-08-30T10:02:00.000Z",
    valueAvailable: false,
  }],
  cases: [], events: [], documents: [], alerts: [],
  operationalSummary: {
    monitoringExecutions: 0,
    outboxEvents: 0,
    documentMaterializations: 0,
    documentDownloads: 0,
  },
  omitted: [{
    dataClass: "monitoring_target_plaintext",
    reason: "not_recoverable_from_current_target_schema",
  }],
});

const repository = (): TenantDataLifecycleWorkerRepository => ({
  claimDue: vi.fn().mockResolvedValue([]),
  snapshotExport: vi.fn().mockResolvedValue(snapshot()),
  completeExport: vi.fn().mockResolvedValue(undefined),
  listDeletionObjectIds: vi.fn().mockResolvedValue([]),
  completeDeletion: vi.fn().mockResolvedValue(undefined),
  fail: vi.fn().mockResolvedValue(undefined),
  listDueExpirations: vi.fn().mockResolvedValue([]),
  expireExport: vi.fn().mockResolvedValue(undefined),
});
const store = (): TenantLifecycleObjectStore => ({
  writeExport: vi.fn().mockResolvedValue(
    `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`,
  ),
  deleteObject: vi.fn().mockResolvedValue(undefined),
});
const protector = (): IdentifierProtector => ({
  protect: vi.fn(),
  reveal: vi.fn().mockReturnValue("Pessoa Sintética Exportada"),
});
const config = {
  workerId: "lifecycle-worker-local",
  batchSize: 10,
  leaseDurationMs: 60_000,
  baseBackoffMs: 60_000,
  maxBackoffMs: 3_600_000,
  maxAttempts: 3,
  maximumExportBytes: 10 * 1024 * 1024,
  expirationBatchSize: 10,
};

const worker = (
  repo = repository(),
  objectStore = store(),
  identifierProtector = protector(),
  metricSink = vi.fn(),
) => ({
  repo, objectStore, identifierProtector, metricSink,
  instance: new TenantDataLifecycleWorker(
    repo, objectStore, identifierProtector, metricSink, config,
    () => NOW, () => ARTIFACT,
  ),
});

describe("TenantDataLifecycleWorker", () => {
  it("reveals subjects in memory and writes a redacted deterministic export", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);

    await expect(fixture.instance.runTick()).resolves.toEqual({
      expired: 0, expirationFailed: 0, claimed: 1,
      exported: 1, deleted: 0, retried: 0, dead: 0,
      acknowledgementFailed: 0,
    });
    expect(fixture.identifierProtector.reveal).toHaveBeenCalledWith({
      tenantId: TENANT,
      identifierType: "name",
      encryptedValue: "aes-256-gcm:v1:synthetic",
      keyVersion: "v1",
    });
    const write = vi.mocked(fixture.objectStore.writeExport).mock.calls[0]![0];
    const document = Buffer.from(write.bytes).toString("utf8");
    expect(document).toContain("Pessoa Sintética Exportada");
    expect(document).not.toContain("aes-256-gcm");
    expect(document).not.toContain("encryptedValue");
    expect(document).not.toContain("leaseToken");
    expect(write).toMatchObject({ tenantId: TENANT, requestId: REQUEST,
      artifactId: ARTIFACT });
    expect(write.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fixture.repo.completeExport).toHaveBeenCalledWith(expect.objectContaining({
      ...exportClaim, artifactId: ARTIFACT,
      storageObjectId: `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`,
      sizeBytes: write.bytes.byteLength,
    }));
  });

  it.each([
    ["wrong tenant", { ...snapshot(), tenant: { ...snapshot().tenant,
      tenantId: "10000000-0000-7000-8000-000000000002" } }],
    ["extra key", { ...snapshot(), providerSubject: "forbidden" }],
    ["ciphertext leak", { ...snapshot(), cases: [{ encryptedValue: "leak" }] }],
    ["malformed subject", { ...snapshot(), protectedSubjects: [{}] }],
    ["non-object snapshot", []],
    ["invalid subject identifier", { ...snapshot(), protectedSubjects: [{
      ...snapshot().protectedSubjects[0], subjectId: "invalid",
    }] }],
    ["invalid subject archive date", { ...snapshot(), protectedSubjects: [{
      ...snapshot().protectedSubjects[0], archivedAt: "invalid",
    }] }],
    ["ciphertext-like public value", { ...snapshot(), cases: [{
      publicText: "aes-256-gcm:forbidden",
    }] }],
    ["blind-index-like public value", { ...snapshot(), cases: [{
      publicText: "hmac-sha256:forbidden",
    }] }],
    ["control character in public value", { ...snapshot(), cases: [{
      publicText: "unsafe\u0001value",
    }] }],
  ])("terminally rejects %s in the internal snapshot", async (_label, value) => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);
    vi.mocked(fixture.repo.snapshotExport).mockResolvedValue(value);
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(fixture.objectStore.writeExport).not.toHaveBeenCalled();
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "EXPORT_SNAPSHOT_INVALID", terminal: true,
      nextAttemptAt: null,
    }));
  });

  it("fails closed when identifier reveal is unavailable", async () => {
    const fixture = worker(repository(), store(), { protect: vi.fn() });
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "IDENTIFIER_REVEAL_FAILED", terminal: true,
    }));
  });

  it("accepts JSON whitespace but rejects control characters in revealed values", async () => {
    const accepted = worker();
    vi.mocked(accepted.repo.claimDue).mockResolvedValue([exportClaim]);
    vi.mocked(accepted.repo.snapshotExport).mockResolvedValue({
      ...snapshot(), cases: [{ publicText: "line\tvalue" }],
    });
    await expect(accepted.instance.runTick()).resolves.toMatchObject({ exported: 1 });

    const rejected = worker(repository(), store(), {
      protect: vi.fn(), reveal: vi.fn().mockReturnValue("unsafe\u0001value"),
    });
    vi.mocked(rejected.repo.claimDue).mockResolvedValue([exportClaim]);
    await expect(rejected.instance.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(rejected.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "IDENTIFIER_REVEAL_FAILED",
    }));
  });

  it("rejects an export larger than the configured bound", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);
    vi.mocked(fixture.repo.snapshotExport).mockResolvedValue({
      ...snapshot(),
      cases: [{ publicText: "X".repeat(config.maximumExportBytes) }],
    });
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "EXPORT_TOO_LARGE", terminal: true,
    }));
  });

  it("retries an object-store failure with bounded exponential backoff", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([
      { ...exportClaim, attemptCount: 2 },
    ]);
    vi.mocked(fixture.objectStore.writeExport).mockRejectedValue(new Error("path"));
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ retried: 1 });
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "STORAGE_FAILED", terminal: false,
      nextAttemptAt: new Date(NOW.getTime() + 120_000),
    }));
  });

  it.each([
    ["snapshot read", "DATABASE_FAILED", (fixture: ReturnType<typeof worker>) => {
      vi.mocked(fixture.repo.snapshotExport).mockRejectedValue(new Error("database"));
    }],
    ["artifact identity", "ARTIFACT_ID_INVALID", (fixture: ReturnType<typeof worker>) => {
      void fixture; // Artifact dependency is replaced below.
    }],
    ["object locator", "STORAGE_FAILED", (fixture: ReturnType<typeof worker>) => {
      vi.mocked(fixture.objectStore.writeExport).mockResolvedValue("exports/wrong.json");
    }],
  ] as const)("fails closed on invalid %s", async (_label, failureCode, arrange) => {
    const fixture = failureCode === "ARTIFACT_ID_INVALID"
      ? (() => {
          const repo = repository();
          const objectStore = store();
          return {
            repo, objectStore, identifierProtector: protector(), metricSink: vi.fn(),
            instance: new TenantDataLifecycleWorker(
              repo, objectStore, protector(), vi.fn(), config,
              () => NOW, () => "invalid",
            ),
          };
        })()
      : worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);
    arrange(fixture);
    const terminal = failureCode === "ARTIFACT_ID_INVALID";
    await expect(fixture.instance.runTick()).resolves.toMatchObject(
      terminal ? { dead: 1 } : { retried: 1 },
    );
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode, terminal,
    }));
  });

  it("maps an unexpected snapshot projection error to a safe terminal code", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    vi.mocked(fixture.repo.snapshotExport).mockResolvedValue({
      ...snapshot(), cases: [cyclic],
    });
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "EXPORT_SNAPSHOT_INVALID", terminal: true,
    }));
  });

  it("deletes every inventoried object before completing deletion", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([deletionClaim]);
    const objects = [
      `documents/tenant/${TENANT}/50000000-0000-7000-8000-000000000001/${ARTIFACT}.pdf`,
      `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`,
    ];
    vi.mocked(fixture.repo.listDeletionObjectIds).mockResolvedValue(objects);
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ deleted: 1 });
    expect(fixture.objectStore.deleteObject).toHaveBeenCalledTimes(2);
    expect(fixture.repo.completeDeletion).toHaveBeenCalledWith({
      ...deletionClaim, deletedAt: NOW, purgedObjectCount: 2,
    });
  });

  it("does not purge the database when one object cannot be reconciled", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([deletionClaim]);
    vi.mocked(fixture.repo.listDeletionObjectIds).mockResolvedValue(["opaque-object"]);
    vi.mocked(fixture.objectStore.deleteObject).mockRejectedValue(new Error("denied"));
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ retried: 1 });
    expect(fixture.repo.completeDeletion).not.toHaveBeenCalled();
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "STORAGE_FAILED", terminal: false,
    }));
  });

  it.each([
    ["inventory", (fixture: ReturnType<typeof worker>) =>
      vi.mocked(fixture.repo.listDeletionObjectIds)
        .mockRejectedValue(new Error("database")), "DATABASE_FAILED"],
    ["completion", (fixture: ReturnType<typeof worker>) =>
      vi.mocked(fixture.repo.completeDeletion)
        .mockRejectedValue(new Error("database")), "ACKNOWLEDGEMENT_FAILED"],
  ] as const)("retries a deletion %s failure", async (_label, arrange, code) => {
    const fixture = worker();
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([deletionClaim]);
    arrange(fixture);
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ retried: 1 });
    expect(fixture.repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: code, terminal: false,
    }));
  });

  it("deletes expired objects before marking their rows expired", async () => {
    const fixture = worker();
    const objectId = `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`;
    vi.mocked(fixture.repo.listDueExpirations).mockResolvedValue([{
      requestId: REQUEST, tenantId: TENANT, storageObjectId: objectId,
    }]);
    await expect(fixture.instance.runTick()).resolves.toMatchObject({ expired: 1 });
    expect(fixture.objectStore.deleteObject).toHaveBeenCalledWith(objectId);
    expect(fixture.repo.expireExport).toHaveBeenCalledWith({
      requestId: REQUEST, expiredAt: NOW,
    });
    expect(vi.mocked(fixture.objectStore.deleteObject).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(fixture.repo.expireExport).mock.invocationCallOrder[0]!);
  });

  it("keeps a failed expiration reconciliable without claiming normal work", async () => {
    const fixture = worker();
    vi.mocked(fixture.repo.listDueExpirations).mockResolvedValue([{
      requestId: REQUEST, tenantId: TENANT, storageObjectId: "invalid",
    }]);
    vi.mocked(fixture.objectStore.deleteObject).mockRejectedValue(new Error("failure"));
    await expect(fixture.instance.runTick()).resolves.toMatchObject({
      expired: 0, expirationFailed: 1,
    });
    expect(fixture.repo.expireExport).not.toHaveBeenCalled();
    expect(fixture.repo.claimDue).toHaveBeenCalled();
  });

  it("records acknowledgement failure without leaking the snapshot to telemetry", async () => {
    const metricSink = vi.fn(() => { throw new Error("metric sink"); });
    const fixture = worker(repository(), store(), protector(), metricSink);
    vi.mocked(fixture.repo.claimDue).mockResolvedValue([exportClaim]);
    vi.mocked(fixture.repo.completeExport).mockRejectedValue(new Error("database"));
    vi.mocked(fixture.repo.fail).mockRejectedValue(new Error("lease conflict"));
    await expect(fixture.instance.runTick()).resolves.toMatchObject({
      acknowledgementFailed: 1,
    });
    expect(JSON.stringify(metricSink.mock.calls)).not.toContain("Pessoa Sintética");
  });

  it.each([
    { ...config, workerId: "bad worker" },
    { ...config, batchSize: 0 },
    { ...config, leaseDurationMs: 1 },
    { ...config, baseBackoffMs: 1 },
    { ...config, maxBackoffMs: 1 },
    { ...config, maxAttempts: 4 },
    { ...config, maximumExportBytes: 0 },
    { ...config, expirationBatchSize: 11 },
  ])("rejects unsafe worker configuration", (invalid) => {
    expect(() => new TenantDataLifecycleWorker(
      repository(), store(), protector(), vi.fn(), invalid,
      () => NOW, () => ARTIFACT,
    )).toThrow(TenantDataLifecycleWorkerConfigurationError);
  });

  it("supports the production clock default", async () => {
    const repo = repository();
    const instance = new TenantDataLifecycleWorker(
      repo, store(), protector(), vi.fn(), config, undefined, () => ARTIFACT,
    );
    await expect(instance.runTick()).resolves.toMatchObject({ claimed: 0 });
    expect(repo.listDueExpirations).toHaveBeenCalledWith({
      now: expect.any(Date), limit: 10,
    });
  });
});
