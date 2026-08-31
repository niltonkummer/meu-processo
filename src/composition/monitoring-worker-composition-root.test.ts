import { describe, expect, it, vi } from "vitest";

import type { MonitoringWorkRepository } from "../application/monitoring-worker.js";
import { composeMonitoringWorker } from "./monitoring-worker-composition-root.js";

describe("monitoring worker composition root", () => {
  it("opens the restricted repository, runs one tick and closes it", async () => {
    const repository = {
      claimDue: vi.fn<MonitoringWorkRepository["claimDue"]>().mockResolvedValue([]),
      complete: vi.fn<MonitoringWorkRepository["complete"]>(),
      fail: vi.fn<MonitoringWorkRepository["fail"]>(),
    } satisfies MonitoringWorkRepository;
    const close = vi.fn().mockResolvedValue(undefined);
    const openRepository = vi.fn(() => ({ repository, close }));
    const composed = composeMonitoringWorker(
      {
        databaseUrl: "postgresql://worker:password@database/meu_processo",
        poolMax: 3,
        encryption: {
          activeKeyVersion: "v1",
          encryptionKeys: new Map([["v1", Buffer.alloc(32, 1)]]),
          blindIndexVersion: "v1",
          blindIndexKey: Buffer.alloc(32, 2),
        },
        worker: {
          workerId: "worker-local",
          batchSize: 4,
          leaseDurationMs: 60_000,
          successIntervalMs: 86_400_000,
          baseBackoffMs: 300_000,
          maxBackoffMs: 86_400_000,
          maxFailures: 5,
        },
      },
      {
        openRepository,
        now: () => new Date("2026-08-31T12:00:00.000Z"),
      },
    );

    await expect(composed.worker.runTick()).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
    });
    await composed.close();

    expect(openRepository).toHaveBeenCalledWith({
      databaseUrl: "postgresql://worker:password@database/meu_processo",
      poolMax: 3,
    });
    expect(repository.claimDue).toHaveBeenCalledWith({
      workerId: "worker-local",
      now: new Date("2026-08-31T12:00:00.000Z"),
      limit: 4,
      leaseDurationMs: 60_000,
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
