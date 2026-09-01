import { describe, expect, it, vi } from "vitest";

import {
  DocumentMaterializationProjectionError,
  DocumentMaterializationRequestValidationError,
} from "../application/document-materialization-request.js";
import { RepositoryAccessDeniedError } from
  "../application/foundation-repository.js";
import { PostgresDocumentMaterializationRequestRepository } from
  "./postgres-document-materialization-request-repository.js";

const USER = "10000000-0000-8000-8000-000000000001";
const TENANT = "20000000-0000-8000-8000-000000000001";
const CASE = "30000000-0000-8000-8000-000000000001";
const DOCUMENT = "40000000-0000-8000-8000-000000000001";
const MATERIALIZATION = "50000000-0000-8000-8000-000000000001";
const NOW = new Date("2026-08-31T12:00:00.000Z");
const input = {
  caseId: CASE,
  documentId: DOCUMENT,
  materializationId: MATERIALIZATION,
  requestedAt: NOW,
};

const poolFor = (...results: unknown[]) => {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  const release = vi.fn();
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
    query,
    release,
  };
};

describe("PostgresDocumentMaterializationRequestRepository", () => {
  it("requests one materialization inside the tenant transaction", async () => {
    const fixture = poolFor(
      { rows: [] },
      { rows: [] },
      { rows: [{
        materialization_id: MATERIALIZATION,
        document_id: DOCUMENT,
        state: "queued",
      }] },
      { rows: [] },
    );
    const repository = new PostgresDocumentMaterializationRequestRepository(
      fixture.pool,
    );

    await expect(repository.request(
      { userId: USER, tenantId: TENANT }, input,
    )).resolves.toEqual({
      materializationId: MATERIALIZATION,
      documentId: DOCUMENT,
      state: "queued",
    });
    expect(fixture.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("request_tenant_document_materialization"),
      [CASE, DOCUMENT, MATERIALIZATION, NOW],
    );
    expect(fixture.query).toHaveBeenLastCalledWith("commit");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("maps an empty result to not found without exposing eligibility", async () => {
    const fixture = poolFor(
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
    );
    await expect(new PostgresDocumentMaterializationRequestRepository(fixture.pool)
      .request({ userId: USER, tenantId: TENANT }, input))
      .resolves.toBeNull();
  });

  it.each([
    [{ rows: [{ materialization_id: "bad", document_id: DOCUMENT, state: "queued" }] }],
    [{ rows: [{ materialization_id: MATERIALIZATION, document_id: DOCUMENT, state: "bad" }] }],
    [{ rows: [
      { materialization_id: MATERIALIZATION, document_id: DOCUMENT, state: "queued" },
      { materialization_id: MATERIALIZATION, document_id: DOCUMENT, state: "queued" },
    ] }],
  ])("rolls back an invalid database projection", async (result) => {
    const fixture = poolFor({ rows: [] }, { rows: [] }, result, { rows: [] });
    await expect(new PostgresDocumentMaterializationRequestRepository(fixture.pool)
      .request({ userId: USER, tenantId: TENANT }, input))
      .rejects.toBeInstanceOf(DocumentMaterializationProjectionError);
    expect(fixture.query).toHaveBeenLastCalledWith("rollback");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("rejects invalid input before opening a database connection", async () => {
    const connect = vi.fn();
    const repository = new PostgresDocumentMaterializationRequestRepository({
      connect,
    });
    await expect(repository.request(
      { userId: "bad", tenantId: TENANT }, input,
    )).rejects.toBeInstanceOf(DocumentMaterializationRequestValidationError);
    await expect(repository.request(
      { userId: USER, tenantId: TENANT }, { ...input, requestedAt: new Date("bad") },
    )).rejects.toBeInstanceOf(DocumentMaterializationRequestValidationError);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", RepositoryAccessDeniedError],
    ["22023", DocumentMaterializationRequestValidationError],
  ])("maps PostgreSQL %s without leaking its message", async (code, Expected) => {
    const databaseError = Object.assign(new Error("sensitive detail"), { code });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(databaseError)
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const repository = new PostgresDocumentMaterializationRequestRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    });
    await expect(repository.request(
      { userId: USER, tenantId: TENANT }, input,
    )).rejects.toBeInstanceOf(Expected);
    expect(query).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledOnce();
  });

  it("redacts an unknown database failure", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("connection secret"))
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresDocumentMaterializationRequestRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });
    await expect(repository.request(
      { userId: USER, tenantId: TENANT }, input,
    )).rejects.toThrow("Document materialization request failed.");
  });
});
