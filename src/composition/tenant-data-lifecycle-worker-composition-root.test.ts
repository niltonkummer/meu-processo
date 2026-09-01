import { describe, expect, it, vi } from "vitest";

import type {
  TenantDataLifecycleWorkerRepository,
  TenantLifecycleObjectStore,
} from "../application/tenant-data-lifecycle-worker.js";
import { composeTenantDataLifecycleWorker } from
  "./tenant-data-lifecycle-worker-composition-root.js";

const repository = (): TenantDataLifecycleWorkerRepository => ({
  claimDue: vi.fn().mockResolvedValue([]),
  snapshotExport: vi.fn(), completeExport: vi.fn(),
  listDeletionObjectIds: vi.fn(), completeDeletion: vi.fn(), fail: vi.fn(),
  listDueExpirations: vi.fn().mockResolvedValue([]), expireExport: vi.fn(),
});

const config = {
  mode: "local" as const,
  databaseUrl: "postgresql://worker:password@database/meu_processo",
  poolMax: 3,
  objectRoot: "/private/objects",
  encryption: {
    activeKeyVersion: "v1",
    encryptionKeys: new Map([["v1", new Uint8Array(32).fill(1)]]),
    blindIndexVersion: "v1",
    blindIndexKey: new Uint8Array(32).fill(2),
  },
  worker: {
    workerId: "lifecycle-local", batchSize: 4, leaseDurationMs: 60_000,
    baseBackoffMs: 60_000, maxBackoffMs: 3_600_000, maxAttempts: 3,
    maximumExportBytes: 1024, expirationBatchSize: 4,
  },
};

describe("tenant data lifecycle worker composition root", () => {
  it("opens restricted resources, runs one tick and closes the pool", async () => {
    const repo = repository();
    const store = {
      writeExport: vi.fn(), deleteObject: vi.fn(),
    } satisfies TenantLifecycleObjectStore;
    const close = vi.fn().mockResolvedValue(undefined);
    const openRepository = vi.fn(() => ({ repository: repo, close }));
    const openStore = vi.fn().mockResolvedValue(store);
    const composed = await composeTenantDataLifecycleWorker(config, {
      openRepository, openStore,
      now: () => new Date("2026-08-31T14:00:00.000Z"),
      artifactId: () => "30000000-0000-8000-8000-000000000001",
    });
    await expect(composed.worker.runTick()).resolves.toMatchObject({ claimed: 0 });
    await composed.close();
    expect(openRepository).toHaveBeenCalledWith({
      databaseUrl: config.databaseUrl, poolMax: 3,
    });
    expect(openStore).toHaveBeenCalledWith({
      objectRoot: config.objectRoot, maximumExportBytes: 1024,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the repository when opening the store fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await expect(composeTenantDataLifecycleWorker(config, {
      openRepository: () => ({ repository: repository(), close }),
      openStore: vi.fn().mockRejectedValue(new Error("private path")),
    })).rejects.toThrow("private path");
    expect(close).toHaveBeenCalledOnce();
  });

  it("opens GCS only when the lifecycle mode explicitly selects it", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const gcsStore = {
      writeExport: vi.fn(), deleteObject: vi.fn(),
    } satisfies TenantLifecycleObjectStore;
    const openGcsStore = vi.fn(() => gcsStore);
    const composed = await composeTenantDataLifecycleWorker({
      mode: "gcs",
      databaseUrl: config.databaseUrl,
      poolMax: config.poolMax,
      bucketName: "meu-processo-validation",
      encryption: config.encryption,
      worker: config.worker,
    }, {
      openRepository: () => ({ repository: repository(), close }),
      openStore: vi.fn(() => Promise.reject(new Error("local forbidden"))),
      openGcsStore,
    });
    await expect(composed.worker.runTick()).resolves.toMatchObject({ claimed: 0 });
    expect(openGcsStore).toHaveBeenCalledWith({
      bucketName: "meu-processo-validation",
      maximumExportBytes: 1024,
    });
    await composed.close();
  });
});
