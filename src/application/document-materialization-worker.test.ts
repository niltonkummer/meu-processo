import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DocumentMaterializationSourceError,
  DocumentMaterializationWorker,
  DocumentMaterializationWorkerConfigurationError,
  deterministicDocumentArtifactId,
  type ClaimedDocumentMaterialization,
  type DocumentMaterializationRepository,
  type DocumentMaterializationStore,
} from "./document-materialization-worker.js";

const ids = {
  execution: "71000000-0000-7000-8000-000000000001",
  tenant: "11000000-0000-7000-8000-000000000001",
  job: "72000000-0000-7000-8000-000000000001",
  document: "88000000-0000-7000-8000-000000000001",
  artifact: "89000000-0000-7000-8000-000000000001",
};
const now = new Date("2026-08-31T10:00:00.000Z");
const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nsynthetic fixture\n%%EOF\n"));
const hash = `sha256:${createHash("sha256").update(pdf).digest("hex")}`;

const claim: ClaimedDocumentMaterialization = {
  executionId: ids.execution,
  leaseToken: "lease-token-with-enough-entropy",
  tenantId: ids.tenant,
  jobId: ids.job,
  documentId: ids.document,
  sourceCode: "synthetic-worker",
  externalDocumentId: "90000000-0000-7000-8000-000000000001",
  expectedMediaType: "application/pdf",
  attemptCount: 1,
};

const config = {
  workerId: "document-worker-test",
  batchSize: 10,
  leaseDurationMs: 60_000,
  baseBackoffMs: 60_000,
  maxBackoffMs: 3_600_000,
  maxAttempts: 3,
  maximumBytes: 25 * 1024 * 1024,
  artifactTtlMs: 86_400_000,
};

const setup = (overrides?: {
  claims?: readonly ClaimedDocumentMaterialization[];
  fetch?: () => Promise<unknown>;
  scan?: () => Promise<unknown>;
  publish?: DocumentMaterializationStore["publish"];
  complete?: DocumentMaterializationRepository["complete"];
}) => {
  const repository: DocumentMaterializationRepository = {
    claimDue: vi.fn().mockResolvedValue(overrides?.claims ?? [claim]),
    complete: vi.fn(overrides?.complete ?? (() => Promise.resolve())),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const store: DocumentMaterializationStore = {
    stage: vi.fn().mockResolvedValue({ token: "opaque-stage-token" }),
    publish: vi.fn(overrides?.publish ?? (() => Promise.resolve({
      storageObjectId:
        `documents/tenant/${ids.tenant}/${ids.document}/${ids.artifact}.pdf`,
    }))),
    discard: vi.fn().mockResolvedValue(undefined),
  };
  const source = {
    sourceCode: "synthetic-worker",
    fetch: vi.fn(overrides?.fetch ?? (() => Promise.resolve({
      mediaType: "application/pdf",
      bytes: pdf,
    }))),
  };
  const scanner = {
    scan: vi.fn(overrides?.scan ?? (() => Promise.resolve({ status: "clean" }))),
  };
  const metric = vi.fn();
  const worker = new DocumentMaterializationWorker(
    repository,
    { resolve: (sourceCode) => sourceCode === source.sourceCode ? source : undefined },
    scanner,
    store,
    metric,
    config,
    () => now,
    () => ids.artifact,
  );
  return { repository, store, source, scanner, metric, worker };
};

describe("DocumentMaterializationWorker", () => {
  it("claims, quarantines, scans, atomically publishes and completes one PDF", async () => {
    const { worker, repository, store, source, scanner, metric } = setup();

    await expect(worker.runTick()).resolves.toEqual({
      claimed: 1, succeeded: 1, retried: 0, dead: 0,
      acknowledgementFailed: 0,
    });
    expect(repository.claimDue).toHaveBeenCalledWith({
      workerId: config.workerId,
      now,
      limit: 10,
      leaseDurationMs: 60_000,
    });
    expect(source.fetch).toHaveBeenCalledWith({
      executionId: ids.execution,
      documentId: ids.document,
      externalDocumentId: claim.externalDocumentId,
      maximumBytes: config.maximumBytes,
    });
    expect(store.stage).toHaveBeenCalledWith({
      executionId: ids.execution,
      bytes: pdf,
      sha256: hash,
    });
    expect(scanner.scan).toHaveBeenCalledWith({
      stageToken: "opaque-stage-token", bytes: pdf, sha256: hash,
    });
    expect(store.publish).toHaveBeenCalledWith({
      stageToken: "opaque-stage-token",
      tenantId: ids.tenant,
      documentId: ids.document,
      artifactId: ids.artifact,
      bytes: pdf,
      sha256: hash,
    });
    expect(repository.complete).toHaveBeenCalledWith({
      executionId: ids.execution,
      leaseToken: claim.leaseToken,
      completedAt: now,
      artifactId: ids.artifact,
      storageObjectId:
        `documents/tenant/${ids.tenant}/${ids.document}/${ids.artifact}.pdf`,
      contentHash: hash,
      mediaType: "application/pdf",
      sizeBytes: pdf.byteLength,
      expiresAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    expect(store.discard).toHaveBeenCalledWith("opaque-stage-token");
    expect(metric).toHaveBeenCalledWith({
      executionId: ids.execution,
      sourceCode: "synthetic-worker",
      outcome: "succeeded",
      sizeBytes: pdf.byteLength,
    });
  });

  it("returns an empty summary without resolving adapters", async () => {
    const { worker, repository, source } = setup({ claims: [] });
    await expect(worker.runTick()).resolves.toEqual({
      claimed: 0, succeeded: 0, retried: 0, dead: 0,
      acknowledgementFailed: 0,
    });
    expect(repository.claimDue).toHaveBeenCalledOnce();
    expect(source.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong shape", { mediaType: "application/pdf", bytes: pdf, extra: true }],
    ["wrong MIME", { mediaType: "text/html", bytes: pdf }],
    ["wrong bytes", { mediaType: "application/pdf", bytes: Buffer.from("<html>") }],
    ["empty bytes", { mediaType: "application/pdf", bytes: new Uint8Array() }],
    ["oversize", { mediaType: "application/pdf", bytes: new Uint8Array(26 * 1024 * 1024) }],
  ])("fails terminally for %s", async (_label, response) => {
    const { worker, repository, store } = setup({
      fetch: () => Promise.resolve(response),
    });
    await expect(worker.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(repository.fail).toHaveBeenCalledWith({
      executionId: ids.execution,
      leaseToken: claim.leaseToken,
      failedAt: now,
      failureCode: "DOCUMENT_INVALID",
      nextAttemptAt: null,
      terminal: true,
    });
    expect(store.stage).not.toHaveBeenCalled();
  });

  it("fails terminally and discards quarantine when the scanner detects malware", async () => {
    const { worker, repository, store } = setup({
      scan: () => Promise.resolve({ status: "infected" }),
    });
    await expect(worker.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "MALWARE_INFECTED", terminal: true, nextAttemptAt: null,
    }));
    expect(store.publish).not.toHaveBeenCalled();
    expect(store.discard).toHaveBeenCalledWith("opaque-stage-token");
  });

  it("treats an invalid scanner result as a retryable closed failure", async () => {
    const { worker, repository, store } = setup({
      scan: () => Promise.resolve({ status: "clean", detail: "unsafe" }),
    });
    await expect(worker.runTick()).resolves.toMatchObject({ retried: 1 });
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "SCANNER_FAILED",
      terminal: false,
      nextAttemptAt: new Date("2026-08-31T10:01:00.000Z"),
    }));
    expect(store.publish).not.toHaveBeenCalled();
  });

  it("uses bounded retry for a temporary source failure", async () => {
    const { worker, repository } = setup({
      fetch: () => Promise.reject(
        new DocumentMaterializationSourceError("SOURCE_RATE_LIMITED", true),
      ),
    });
    await expect(worker.runTick()).resolves.toMatchObject({ retried: 1 });
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "SOURCE_RATE_LIMITED",
      terminal: false,
      nextAttemptAt: new Date("2026-08-31T10:01:00.000Z"),
    }));
  });

  it.each([
    [() => Promise.reject(new Error("unexpected")), "SOURCE_FAILED"],
    [() => Promise.reject(
      new DocumentMaterializationSourceError("invalid-code", true),
    ), "SOURCE_FAILED"],
    [() => Promise.reject(
      new DocumentMaterializationSourceError("SOURCE_REJECTED", false),
    ), "SOURCE_REJECTED"],
  ])("normalizes an untrusted source failure", async (fetch, failureCode) => {
    const { worker, repository } = setup({ fetch });
    await worker.runTick();
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode,
      terminal: failureCode === "SOURCE_REJECTED",
    }));
  });

  it("fails closed for non-object source and scanner responses", async () => {
    const invalidSource = setup({ fetch: () => Promise.resolve(null) });
    await expect(invalidSource.worker.runTick()).resolves.toMatchObject({ dead: 1 });
    const invalidScanner = setup({ scan: () => Promise.resolve("clean") });
    await expect(invalidScanner.worker.runTick()).resolves.toMatchObject({ retried: 1 });
  });

  it("schedules a capped retry and acknowledges failure-recording outages", async () => {
    const capped = setup({
      claims: [{ ...claim, attemptCount: 2 }],
      fetch: () => Promise.reject(new Error("temporary")),
    });
    const cappedWorker = new DocumentMaterializationWorker(
      capped.repository,
      { resolve: () => capped.source },
      capped.scanner,
      capped.store,
      capped.metric,
      { ...config, baseBackoffMs: 3_600_000, maxBackoffMs: 3_600_000,
        maxAttempts: 20 },
      () => now,
      () => ids.artifact,
    );
    await cappedWorker.runTick();
    expect(capped.repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      nextAttemptAt: new Date("2026-08-31T11:00:00.000Z"),
    }));

    const failedAck = setup({
      fetch: () => Promise.resolve(null),
    });
    vi.mocked(failedAck.repository.fail).mockRejectedValueOnce(
      new Error("database down"),
    );
    await expect(failedAck.worker.runTick()).resolves.toMatchObject({
      acknowledgementFailed: 1, dead: 0,
    });
    expect(failedAck.metric).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "acknowledgement_failed",
    }));
  });

  it("handles quarantine stage and cleanup failures without false success", async () => {
    const stageFailure = setup();
    vi.mocked(stageFailure.store.stage).mockRejectedValueOnce(
      new Error("storage down"),
    );
    await expect(stageFailure.worker.runTick()).resolves.toMatchObject({ retried: 1 });

    const cleanupFailure = setup();
    vi.mocked(cleanupFailure.store.discard).mockRejectedValueOnce(
      new Error("cleanup down"),
    );
    await expect(cleanupFailure.worker.runTick()).resolves.toMatchObject({ succeeded: 1 });
  });

  it("uses the real clock default when no clock is injected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const { repository, source, scanner, store } = setup({ claims: [] });
      const worker = new DocumentMaterializationWorker(
        repository, { resolve: () => source }, scanner, store, vi.fn(), config,
        undefined, () => ids.artifact,
      );
      await worker.runTick();
      expect(repository.claimDue).toHaveBeenCalledWith(expect.objectContaining({ now }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes an unknown adapter terminal without exposing the external id", async () => {
    const { repository, scanner, store } = setup();
    const metric = vi.fn();
    const worker = new DocumentMaterializationWorker(
      repository, { resolve: () => undefined }, scanner, store, metric,
      config, () => now, () => ids.artifact,
    );
    await expect(worker.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "SOURCE_ADAPTER_UNAVAILABLE", terminal: true,
    }));
  });

  it("marks the final attempt dead instead of scheduling another retry", async () => {
    const { worker, repository } = setup({
      claims: [{ ...claim, attemptCount: 3 }],
      publish: () => Promise.reject(new Error("private path must not escape")),
    });
    await expect(worker.runTick()).resolves.toMatchObject({ dead: 1 });
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "STORAGE_FAILED", terminal: true, nextAttemptAt: null,
    }));
  });

  it("does not undo a published object when database acknowledgement fails", async () => {
    const { worker, repository, store, metric } = setup({
      complete: () => Promise.reject(new Error("database unavailable")),
    });
    await expect(worker.runTick()).resolves.toMatchObject({
      claimed: 1, acknowledgementFailed: 1, succeeded: 0,
    });
    expect(repository.fail).not.toHaveBeenCalled();
    expect(store.publish).toHaveBeenCalledOnce();
    expect(store.discard).toHaveBeenCalledWith("opaque-stage-token");
    expect(metric).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "acknowledgement_failed",
    }));
  });

  it("ignores metric failures after durable state changes", async () => {
    const { repository, source, scanner, store } = setup();
    const worker = new DocumentMaterializationWorker(
      repository,
      { resolve: () => source },
      scanner,
      store,
      () => { throw new Error("telemetry down"); },
      config,
      () => now,
      () => ids.artifact,
    );
    await expect(worker.runTick()).resolves.toMatchObject({ succeeded: 1 });
  });

  it.each([
    [{ ...config, workerId: "" }],
    [{ ...config, batchSize: 11 }],
    [{ ...config, leaseDurationMs: 29_999 }],
    [{ ...config, baseBackoffMs: 59_999 }],
    [{ ...config, maxBackoffMs: 59_999 }],
    [{ ...config, maxAttempts: 0 }],
    [{ ...config, maximumBytes: 25 * 1024 * 1024 + 1 }],
    [{ ...config, artifactTtlMs: 3_599_999 }],
  ])("rejects unsafe configuration", (invalid) => {
    const { repository, source, scanner, store } = setup();
    expect(() => new DocumentMaterializationWorker(
      repository, { resolve: () => source }, scanner, store, vi.fn(), invalid,
      () => now, () => ids.artifact,
    )).toThrow(DocumentMaterializationWorkerConfigurationError);
  });

  it("derives a stable version-8 artifact UUID and rejects malformed inputs", () => {
    const input = {
      tenantId: ids.tenant,
      documentId: ids.document,
      contentHash: hash,
    };
    const derived = deterministicDocumentArtifactId(input);
    expect(derived).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(deterministicDocumentArtifactId(input)).toBe(derived);
    for (const invalid of [
      { ...input, tenantId: "invalid" },
      { ...input, documentId: "invalid" },
      { ...input, contentHash: "invalid" },
    ]) {
      expect(() => deterministicDocumentArtifactId(invalid))
        .toThrow(DocumentMaterializationWorkerConfigurationError);
    }
  });
});
