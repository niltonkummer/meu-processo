import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DocumentMaterializationWorkConflictError,
  DocumentMaterializationWorkValidationError,
} from "../application/document-materialization-worker.js";
import { PostgresDocumentMaterializationRepository } from
  "./postgres-document-materialization-repository.js";

const executionId = "71000000-0000-7000-8000-000000000001";
const tenantId = "11000000-0000-7000-8000-000000000001";
const jobId = "72000000-0000-7000-8000-000000000001";
const documentId = "88000000-0000-7000-8000-000000000001";
const artifactId = "89000000-0000-8000-8000-000000000001";
const eventId = "73000000-0000-7000-8000-000000000001";
const token = "lease-token-with-enough-entropy";
const now = new Date("2026-08-31T10:00:00.000Z");
const tokenHash = createHash("sha256").update(token).digest();

describe("PostgresDocumentMaterializationRepository", () => {
  it("claims up to the requested limit and stops on an empty result", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        execution_id: executionId,
        tenant_id: tenantId,
        materialization_id: jobId,
        document_id: documentId,
        source_code: "synthetic-worker",
        external_document_id: "90000000-0000-7000-8000-000000000001",
        expected_media_type: "application/pdf",
        attempt_count: 1,
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresDocumentMaterializationRepository(
      { query }, () => executionId, () => token, () => eventId,
    );

    await expect(repository.claimDue({
      workerId: "worker-test", now, limit: 2, leaseDurationMs: 60_000,
    })).resolves.toEqual([{
      executionId, leaseToken: token, tenantId, jobId, documentId,
      sourceCode: "synthetic-worker",
      externalDocumentId: "90000000-0000-7000-8000-000000000001",
      expectedMediaType: "application/pdf",
      attemptCount: 1,
    }]);
    expect(query).toHaveBeenNthCalledWith(
      1, expect.stringContaining("claim_document_materialization"),
      [executionId, "worker-test", now,
        new Date("2026-08-31T10:01:00.000Z"), tokenHash],
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe claim input and generated credentials", async () => {
    const query = vi.fn();
    const invalid = new PostgresDocumentMaterializationRepository(
      { query }, () => "", () => "short", () => eventId,
    );
    await expect(invalid.claimDue({
      workerId: "", now, limit: 0, leaseDurationMs: 1,
    })).rejects.toBeInstanceOf(DocumentMaterializationWorkValidationError);
    await expect(invalid.claimDue({
      workerId: "worker", now, limit: 1, leaseDurationMs: 60_000,
    })).rejects.toBeInstanceOf(DocumentMaterializationWorkValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it("completes with a stable fingerprint and narrow SQL parameters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ accepted: true }] });
    const repository = new PostgresDocumentMaterializationRepository(
      { query }, () => executionId, () => token, () => eventId,
    );
    const input = {
      executionId, leaseToken: token, completedAt: now, artifactId,
      storageObjectId:
        `documents/tenant/${tenantId}/${documentId}/${artifactId}.pdf`,
      contentHash: `sha256:${"a".repeat(64)}`,
      mediaType: "application/pdf" as const,
      sizeBytes: 128,
      expiresAt: new Date("2026-09-01T10:00:00.000Z"),
    };
    await expect(repository.complete(input)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("complete_document_materialization"),
      [executionId, tokenHash, now, artifactId, input.storageObjectId,
        input.contentHash, "application/pdf", 128, input.expiresAt, "v1",
        expect.any(Buffer), eventId],
    );
    const parameters = query.mock.calls[0]![1] as unknown[];
    expect(parameters[10]).toHaveLength(32);
  });

  it("records retry/dead outcomes and rejects a database conflict", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ accepted: true }] })
      .mockResolvedValueOnce({ rows: [{ accepted: false }] });
    const repository = new PostgresDocumentMaterializationRepository(
      { query }, () => executionId, () => token, () => eventId,
    );
    await repository.fail({
      executionId, leaseToken: token, failedAt: now,
      failureCode: "SOURCE_FAILED",
      nextAttemptAt: new Date("2026-08-31T10:01:00.000Z"), terminal: false,
    });
    expect(query).toHaveBeenNthCalledWith(
      1, expect.stringContaining("fail_document_materialization"),
      [executionId, tokenHash, now, "SOURCE_FAILED",
        new Date("2026-08-31T10:01:00.000Z"), false,
        expect.any(Buffer), eventId],
    );
    await expect(repository.fail({
      executionId, leaseToken: token, failedAt: now,
      failureCode: "SOURCE_FAILED", nextAttemptAt: null, terminal: true,
    })).rejects.toBeInstanceOf(DocumentMaterializationWorkConflictError);
  });

  it.each([
    ["22023", DocumentMaterializationWorkValidationError],
    ["23514", DocumentMaterializationWorkConflictError],
  ])("maps PostgreSQL %s without leaking its message", async (code, Expected) => {
    const query = vi.fn().mockRejectedValue({ code, message: "sensitive row" });
    const repository = new PostgresDocumentMaterializationRepository(
      { query }, () => executionId, () => token, () => eventId,
    );
    await expect(repository.fail({
      executionId, leaseToken: token, failedAt: now,
      failureCode: "SOURCE_FAILED", nextAttemptAt: null, terminal: true,
    })).rejects.toBeInstanceOf(Expected);
  });
});
