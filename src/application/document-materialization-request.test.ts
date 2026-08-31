import { describe, expect, it, vi } from "vitest";

import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  DocumentMaterializationNotFoundError,
  DocumentMaterializationProjectionError,
  DocumentMaterializationRequestValidationError,
  PersonalDocumentMaterializationRequests,
  type DocumentMaterializationRequestRepository,
} from "./document-materialization-request.js";

const USER_ID = "10000000-0000-8000-8000-000000000001";
const TENANT_ID = "20000000-0000-8000-8000-000000000001";
const CASE_ID = "30000000-0000-8000-8000-000000000001";
const DOCUMENT_ID = "40000000-0000-8000-8000-000000000001";
const REQUESTED_ID = "50000000-0000-8000-8000-000000000001";
const EXISTING_ID = "60000000-0000-8000-8000-000000000001";
const NOW = new Date("2026-08-31T12:00:00.000Z");

const resolver = (): PersonalTenantContextResolver => ({
  resolve: vi.fn().mockResolvedValue({ userId: USER_ID, tenantId: TENANT_ID }),
});

describe("PersonalDocumentMaterializationRequests", () => {
  it.each(["queued", "processing", "available"] as const)(
    "returns the minimized %s state and preserves an existing id",
    async (state) => {
      const repository: DocumentMaterializationRequestRepository = {
        request: vi.fn().mockResolvedValue({
          materializationId: EXISTING_ID,
          documentId: DOCUMENT_ID,
          state,
        }),
      };
      const contextResolver = resolver();
      const service = new PersonalDocumentMaterializationRequests(
        contextResolver, repository, () => REQUESTED_ID, () => NOW,
      );

      await expect(service.request("provider-subject", CASE_ID, DOCUMENT_ID))
        .resolves.toEqual({
          materializationId: EXISTING_ID,
          documentId: DOCUMENT_ID,
          state,
        });
      expect(contextResolver.resolve).toHaveBeenCalledWith("provider-subject");
      expect(repository.request).toHaveBeenCalledWith(
        { userId: USER_ID, tenantId: TENANT_ID },
        {
          caseId: CASE_ID,
          documentId: DOCUMENT_ID,
          materializationId: REQUESTED_ID,
          requestedAt: NOW,
        },
      );
    },
  );

  it.each([
    ["case-id", DOCUMENT_ID],
    [CASE_ID, "document-id"],
  ])("rejects invalid route identifiers before identity resolution", async (caseId, documentId) => {
    const contextResolver = resolver();
    const repository: DocumentMaterializationRequestRepository = {
      request: vi.fn(),
    };
    const service = new PersonalDocumentMaterializationRequests(
      contextResolver, repository, () => REQUESTED_ID,
    );

    await expect(service.request("provider-subject", caseId, documentId))
      .rejects.toBeInstanceOf(DocumentMaterializationRequestValidationError);
    expect(contextResolver.resolve).not.toHaveBeenCalled();
    expect(repository.request).not.toHaveBeenCalled();
  });

  it("hides an ineligible or cross-tenant document as not found", async () => {
    const service = new PersonalDocumentMaterializationRequests(
      resolver(), { request: vi.fn().mockResolvedValue(null) },
      () => REQUESTED_ID,
    );
    await expect(service.request("provider-subject", CASE_ID, DOCUMENT_ID))
      .rejects.toBeInstanceOf(DocumentMaterializationNotFoundError);
  });

  it.each([
    { materializationId: "invalid", documentId: DOCUMENT_ID, state: "queued" },
    { materializationId: EXISTING_ID, documentId: CASE_ID, state: "queued" },
    { materializationId: EXISTING_ID, documentId: DOCUMENT_ID, state: "complete" },
  ])("fails closed for an invalid repository projection", async (projection) => {
    const service = new PersonalDocumentMaterializationRequests(
      resolver(), { request: vi.fn().mockResolvedValue(projection) },
      () => REQUESTED_ID,
    );
    await expect(service.request("provider-subject", CASE_ID, DOCUMENT_ID))
      .rejects.toBeInstanceOf(DocumentMaterializationProjectionError);
  });

  it("fails closed when generated request metadata is invalid", async () => {
    const repository: DocumentMaterializationRequestRepository = {
      request: vi.fn(),
    };
    const invalidId = new PersonalDocumentMaterializationRequests(
      resolver(), repository, () => "invalid", () => NOW,
    );
    const invalidDate = new PersonalDocumentMaterializationRequests(
      resolver(), repository, () => REQUESTED_ID, () => new Date("invalid"),
    );
    await expect(invalidId.request("provider-subject", CASE_ID, DOCUMENT_ID))
      .rejects.toBeInstanceOf(DocumentMaterializationProjectionError);
    await expect(invalidDate.request("provider-subject", CASE_ID, DOCUMENT_ID))
      .rejects.toBeInstanceOf(DocumentMaterializationProjectionError);
    expect(repository.request).not.toHaveBeenCalled();
  });
});
