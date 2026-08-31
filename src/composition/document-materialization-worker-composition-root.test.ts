import { describe, expect, it, vi } from "vitest";

import type {
  DocumentMaterializationRepository,
  DocumentMaterializationSourceAdapter,
  DocumentMaterializationStore,
} from "../application/document-materialization-worker.js";
import { composeDocumentMaterializationWorker } from
  "./document-materialization-worker-composition-root.js";

describe("document materialization worker composition root", () => {
  it("opens restricted resources, runs one tick and closes the pool", async () => {
    const repository = {
      claimDue: vi.fn<DocumentMaterializationRepository["claimDue"]>()
        .mockResolvedValue([]),
      complete: vi.fn<DocumentMaterializationRepository["complete"]>(),
      fail: vi.fn<DocumentMaterializationRepository["fail"]>(),
    } satisfies DocumentMaterializationRepository;
    const source = {
      sourceCode: "synthetic-worker",
      fetch: vi.fn(),
    } satisfies DocumentMaterializationSourceAdapter;
    const store = {
      stage: vi.fn(), publish: vi.fn(), discard: vi.fn(),
    } satisfies DocumentMaterializationStore;
    const close = vi.fn().mockResolvedValue(undefined);
    const openRepository = vi.fn(() => ({ repository, close }));
    const openSource = vi.fn().mockResolvedValue(source);
    const openStore = vi.fn().mockResolvedValue(store);
    const composed = await composeDocumentMaterializationWorker({
      mode: "local-fixture",
      databaseUrl: "postgresql://worker:password@database/meu_processo",
      poolMax: 3,
      fixtureRoot: "/private/fixtures",
      objectRoot: "/private/objects",
      sourceCode: "synthetic-worker",
      worker: {
        workerId: "worker-local", batchSize: 4, leaseDurationMs: 60_000,
        baseBackoffMs: 60_000, maxBackoffMs: 3_600_000, maxAttempts: 5,
        maximumBytes: 1024, artifactTtlMs: 86_400_000,
      },
    }, {
      openRepository, openSource, openStore,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    await expect(composed.worker.runTick()).resolves.toEqual({
      claimed: 0, succeeded: 0, retried: 0, dead: 0,
      acknowledgementFailed: 0,
    });
    await composed.close();
    expect(openRepository).toHaveBeenCalledWith({
      databaseUrl: "postgresql://worker:password@database/meu_processo",
      poolMax: 3,
    });
    expect(openSource).toHaveBeenCalledWith({
      fixtureRoot: "/private/fixtures", sourceCode: "synthetic-worker",
      maximumBytes: 1024,
    });
    expect(openStore).toHaveBeenCalledWith({
      objectRoot: "/private/objects", maximumBytes: 1024,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("opens the GCS store only for an explicit GCS fixture mode", async () => {
    const repository = {
      claimDue: vi.fn<DocumentMaterializationRepository["claimDue"]>()
        .mockResolvedValue([]),
      complete: vi.fn<DocumentMaterializationRepository["complete"]>(),
      fail: vi.fn<DocumentMaterializationRepository["fail"]>(),
    } satisfies DocumentMaterializationRepository;
    const source = {
      sourceCode: "synthetic-worker", fetch: vi.fn(),
    } satisfies DocumentMaterializationSourceAdapter;
    const gcsStore = {
      stage: vi.fn(), publish: vi.fn(), discard: vi.fn(),
    } satisfies DocumentMaterializationStore;
    const close = vi.fn().mockResolvedValue(undefined);
    const openGcsStore = vi.fn(() => gcsStore);
    const composed = await composeDocumentMaterializationWorker({
      mode: "gcs-fixture",
      databaseUrl: "postgresql://worker:password@database/meu_processo",
      poolMax: 3,
      fixtureRoot: "/private/fixtures",
      bucketName: "meu-processo-validation",
      sourceCode: "synthetic-worker",
      worker: {
        workerId: "worker-gcs", batchSize: 4, leaseDurationMs: 60_000,
        baseBackoffMs: 60_000, maxBackoffMs: 3_600_000, maxAttempts: 5,
        maximumBytes: 1024, artifactTtlMs: 86_400_000,
      },
    }, {
      openRepository: () => ({ repository, close }),
      openSource: vi.fn().mockResolvedValue(source),
      openStore: vi.fn(() => Promise.reject(new Error("local forbidden"))),
      openGcsStore,
    });
    await expect(composed.worker.runTick()).resolves.toMatchObject({ claimed: 0 });
    expect(openGcsStore).toHaveBeenCalledWith({
      bucketName: "meu-processo-validation", maximumBytes: 1024,
    });
    await composed.close();
  });
});
