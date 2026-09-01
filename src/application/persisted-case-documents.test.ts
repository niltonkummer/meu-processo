import { describe, expect, it, vi } from "vitest";

import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  CaseDocumentPageValidationError,
  CaseDocumentsNotFoundError,
  PersonalCaseDocuments,
  type PersistedCaseDocumentRepository,
} from "./persisted-case-documents.js";

const TENANT = "10000000-0000-7000-8000-000000000001";
const USER = "00000000-0000-7000-8000-000000000001";
const CASE = "83000000-0000-7000-8000-000000000001";
const DOCUMENT = "88000000-0000-7000-8000-000000000001";
const EVENT = "86000000-0000-7000-8000-000000000001";
const ARTIFACT = "89000000-0000-7000-8000-000000000001";

const resolver = {
  resolve: vi.fn().mockResolvedValue({ userId: USER, tenantId: TENANT }),
} as unknown as PersonalTenantContextResolver;

const item = {
  tenantId: TENANT,
  documentId: DOCUMENT,
  caseId: CASE,
  caseEventId: EVENT,
  title: "Intimação para manifestação",
  documentType: "intimacao",
  accessClass: "public_official" as const,
  availabilityStatus: "available" as const,
  expectedMediaType: "application/pdf" as const,
  sourceCreatedAt: new Date("2026-08-31T10:00:00.000Z"),
  lastVerifiedAt: new Date("2026-08-31T11:00:00.000Z"),
  source: { sourceId: "djen", official: true },
  artifact: {
    artifactId: ARTIFACT,
    mediaType: "application/pdf" as const,
    sizeBytes: 2048,
    sha256: `sha256:${"a".repeat(64)}`,
    expiresAt: new Date("2026-09-01T11:00:00.000Z"),
  },
};

describe("PersonalCaseDocuments", () => {
  it("projects safe metadata and a deterministic opaque cursor", async () => {
    const repository: PersistedCaseDocumentRepository = {
      list: vi.fn().mockResolvedValue({
        caseFound: true,
        items: [item],
        next: { sourceCreatedAt: item.sourceCreatedAt, documentId: DOCUMENT },
      }),
    };
    const service = new PersonalCaseDocuments(resolver, repository);

    const first = await service.list("provider-user", CASE, { limit: 1 });

    expect(first.items).toEqual([{
      documentId: DOCUMENT,
      caseId: CASE,
      caseEventId: EVENT,
      title: item.title,
      documentType: "intimacao",
      accessClass: "public_official",
      availabilityStatus: "available",
      expectedMediaType: "application/pdf",
      sourceCreatedAt: "2026-08-31T10:00:00.000Z",
      lastVerifiedAt: "2026-08-31T11:00:00.000Z",
      source: { sourceId: "djen", official: true },
      artifact: {
        artifactId: ARTIFACT,
        mediaType: "application/pdf",
        sizeBytes: 2048,
        sha256: `sha256:${"a".repeat(64)}`,
        expiresAt: "2026-09-01T11:00:00.000Z",
      },
    }]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    await service.list("provider-user", CASE, {
      limit: 20,
      cursor: first.nextCursor!,
    });
    expect(repository.list).toHaveBeenLastCalledWith(
      { userId: USER, tenantId: TENANT },
      CASE,
      {
        limit: 20,
        after: { sourceCreatedAt: item.sourceCreatedAt, documentId: DOCUMENT },
      },
    );
  });

  it("supports metadata-only documents with nullable event, type and artifact", async () => {
    const repository: PersistedCaseDocumentRepository = {
      list: vi.fn().mockResolvedValue({
        caseFound: true,
        items: [{
          ...item,
          caseEventId: null,
          documentType: null,
          availabilityStatus: "metadata_only",
          artifact: null,
        }],
        next: null,
      }),
    };
    const result = await new PersonalCaseDocuments(resolver, repository)
      .list("provider-user", CASE, { limit: 20 });
    expect(result.items[0]).toMatchObject({
      caseEventId: null,
      documentType: null,
      availabilityStatus: "metadata_only",
      artifact: null,
    });
    expect(result.nextCursor).toBeNull();
  });

  it("hides absent, foreign and mismatched process results", async () => {
    for (const result of [
      { caseFound: false, items: [], next: null },
      { caseFound: true, items: [{ ...item, tenantId: "10000000-0000-7000-8000-000000000002" }], next: null },
      { caseFound: true, items: [{ ...item, caseId: "83000000-0000-7000-8000-000000000002" }], next: null },
    ]) {
      const repository: PersistedCaseDocumentRepository = {
        list: vi.fn().mockResolvedValue(result),
      };
      await expect(new PersonalCaseDocuments(resolver, repository)
        .list("provider-user", CASE, { limit: 20 }))
        .rejects.toBeInstanceOf(CaseDocumentsNotFoundError);
    }
  });

  it.each([
    ["bad case", "not-a-uuid", { limit: 20 }],
    ["zero limit", CASE, { limit: 0 }],
    ["large limit", CASE, { limit: 101 }],
    ["fractional limit", CASE, { limit: 1.5 }],
    ["short cursor", CASE, { limit: 20, cursor: "short" }],
    ["invalid encoded cursor", CASE, { limit: 20, cursor: "not_a_valid_cursor" }],
    ["non-object cursor", CASE, { limit: 20, cursor: Buffer.from('["longvalue"]').toString("base64url") }],
    ["wrong cursor shape", CASE, { limit: 20, cursor: Buffer.from(JSON.stringify({ v: 2, at: "2026-08-31", id: DOCUMENT })).toString("base64url") }],
    ["invalid cursor date", CASE, { limit: 20, cursor: Buffer.from(JSON.stringify({ v: 1, at: "bad", id: DOCUMENT })).toString("base64url") }],
    ["invalid cursor id", CASE, { limit: 20, cursor: Buffer.from(JSON.stringify({ v: 1, at: "2026-08-31T10:00:00Z", id: "bad" })).toString("base64url") }],
    ["extra cursor field", CASE, { limit: 20, cursor: Buffer.from(JSON.stringify({ v: 1, at: "2026-08-31T10:00:00Z", id: DOCUMENT, extra: true })).toString("base64url") }],
  ])("rejects %s", async (_label, caseId, page) => {
    const repository: PersistedCaseDocumentRepository = { list: vi.fn() };
    await expect(new PersonalCaseDocuments(resolver, repository)
      .list("provider-user", caseId, page as { limit: number; cursor?: string }))
      .rejects.toBeInstanceOf(CaseDocumentPageValidationError);
    expect(repository.list).not.toHaveBeenCalled();
  });
});
