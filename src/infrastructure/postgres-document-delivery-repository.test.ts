import { describe, expect, it, vi } from "vitest";

import { DocumentDeliveryValidationError } from "../application/individual-document-delivery.js";
import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import {
  DocumentDeliveryProjectionError,
  PostgresDocumentDeliveryRepository,
} from "./postgres-document-delivery-repository.js";

const USER = "00000000-0000-7000-8000-000000000961";
const TENANT = "10000000-0000-7000-8000-000000000961";
const CASE = "83000000-0000-7000-8000-000000000961";
const DOCUMENT = "88000000-0000-7000-8000-000000000961";
const ARTIFACT = "89000000-0000-7000-8000-000000000961";
const AUTHORIZATION = "8a000000-0000-7000-8000-000000000961";
const REQUEST = "8b000000-0000-7000-8000-000000000961";

const authorizedRow = {
  result_status: "authorized",
  authorization_id: AUTHORIZATION,
  tenant_id: TENANT,
  user_id: USER,
  case_id: CASE,
  document_id: DOCUMENT,
  artifact_id: ARTIFACT,
  storage_object_id: `documents/tenant/${TENANT}/${DOCUMENT}/${ARTIFACT}.pdf`,
  title: "Decisão judicial",
  media_type: "application/pdf",
  size_bytes: 512,
  content_hash: `sha256:${"a".repeat(64)}`,
};

const input = {
  caseId: CASE,
  documentId: DOCUMENT,
  authorizationId: AUTHORIZATION,
  requestId: REQUEST,
  quotaPerMinute: 20,
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

describe("PostgresDocumentDeliveryRepository", () => {
  it("maps a strict authorized projection inside a scoped transaction", async () => {
    const fixture = poolFor(
      { rows: [] }, { rows: [] }, { rows: [authorizedRow] }, { rows: [] },
    );
    const result = await new PostgresDocumentDeliveryRepository(fixture.pool)
      .authorize({ userId: USER, tenantId: TENANT }, input);
    expect(result).toEqual({
      kind: "authorized",
      authorization: {
        authorizationId: AUTHORIZATION,
        tenantId: TENANT,
        userId: USER,
        caseId: CASE,
        documentId: DOCUMENT,
        artifactId: ARTIFACT,
        storageObjectId: authorizedRow.storage_object_id,
        title: "Decisão judicial",
        mediaType: "application/pdf",
        sizeBytes: 512,
        sha256: authorizedRow.content_hash,
      },
    });
    expect(fixture.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining("authorize_tenant_document_download"),
      [CASE, DOCUMENT, AUTHORIZATION, REQUEST, 20],
    );
    expect(fixture.query).toHaveBeenLastCalledWith("commit");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it.each(["not_found", "quota_exceeded"] as const)(
    "maps the %s decision without private fields",
    async (status) => {
      const fixture = poolFor(
        { rows: [] }, { rows: [] },
        { rows: [{ ...authorizedRow, result_status: status,
          authorization_id: null, tenant_id: null, user_id: null, case_id: null,
          document_id: null, artifact_id: null, storage_object_id: null,
          title: null, media_type: null, size_bytes: null, content_hash: null }] },
        { rows: [] },
      );
      await expect(new PostgresDocumentDeliveryRepository(fixture.pool)
        .authorize({ userId: USER, tenantId: TENANT }, input))
        .resolves.toEqual({ kind: status });
    },
  );

  it("records one outcome through the scoped function", async () => {
    const fixture = poolFor(
      { rows: [] }, { rows: [] }, { rows: [{ recorded: true }] }, { rows: [] },
    );
    await expect(new PostgresDocumentDeliveryRepository(fixture.pool)
      .recordOutcome(
        { userId: USER, tenantId: TENANT }, AUTHORIZATION, "delivered",
      )).resolves.toBe(true);
    expect(fixture.query).toHaveBeenNthCalledWith(3,
      "select app_private.record_document_download_outcome($1::uuid, $2::text) as recorded",
      [AUTHORIZATION, "delivered"],
    );
  });

  it("rejects invalid input before opening the pool", async () => {
    const connect = vi.fn();
    const repository = new PostgresDocumentDeliveryRepository({ connect });
    await expect(repository.authorize(
      { userId: USER, tenantId: TENANT }, { ...input, caseId: "bad" },
    )).rejects.toBeInstanceOf(DocumentDeliveryValidationError);
    await expect(repository.recordOutcome(
      { userId: USER, tenantId: TENANT }, AUTHORIZATION, "bad" as "delivered",
    )).rejects.toBeInstanceOf(DocumentDeliveryValidationError);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    [{ rows: [] }, DocumentDeliveryProjectionError],
    [{ rows: [{ ...authorizedRow, media_type: "text/html" }] }, DocumentDeliveryProjectionError],
  ])("rolls back malformed database projections", async (projection, errorType) => {
    const fixture = poolFor(
      { rows: [] }, { rows: [] }, projection, { rows: [] },
    );
    await expect(new PostgresDocumentDeliveryRepository(fixture.pool)
      .authorize({ userId: USER, tenantId: TENANT }, input))
      .rejects.toBeInstanceOf(errorType);
    expect(fixture.query).toHaveBeenLastCalledWith("rollback");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("maps database access denial and always releases the client", async () => {
    const denied = Object.assign(new Error("database detail"), { code: "42501" });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const repository = new PostgresDocumentDeliveryRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    });
    await expect(repository.authorize(
      { userId: USER, tenantId: TENANT }, input,
    )).rejects.toBeInstanceOf(RepositoryAccessDeniedError);
    expect(query).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledOnce();
  });
});
