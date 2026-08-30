import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal, TenantScope } from "../domain/access-control.js";
import type { CanonicalCase, CaseRepository } from "./case-portfolio.js";
import {
  downloadAuthorizedDocument,
  listAuthorizedDocuments,
  DocumentNotFoundError,
  type DocumentClient,
  type DocumentReference,
  type DocumentRepository,
} from "./document-gateway.js";

const scope: TenantScope = { kind: "personal", userId: "user_alpha" };
const foreignScope: TenantScope = { kind: "personal", userId: "user_beta" };
const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [],
};

const canonicalCase: CanonicalCase = {
  caseId: "case_alpha",
  scope,
  cnjNumber: "0000001-23.2026.8.99.0001",
  tribunal: "TJEX",
  identityStatus: "confirmed",
  lastUpdatedAt: "2026-08-29T12:00:00.000Z",
  sources: [],
  events: [],
};

const reference: DocumentReference = {
  documentId: "doc_alpha",
  caseId: "case_alpha",
  scope,
  sourceId: "DJEN",
  title: "Certidão de publicação",
  fileName: "certidao.pdf",
  mediaType: "application/pdf",
  sourceUrl: "https://documentos.tribunal.example/certidao.pdf",
  collectedAt: "2026-08-29T12:00:00.000Z",
};

const caseRepository = (foundCase: CanonicalCase | undefined = canonicalCase): CaseRepository => ({
  list: vi.fn(),
  findById: vi.fn().mockResolvedValue(foundCase),
});

describe("document gateway authorization", () => {
  it("lists only scoped documents and never exposes source URLs", async () => {
    const leakedReference: DocumentReference = {
      ...reference,
      documentId: "doc_beta",
      scope: foreignScope,
    };
    const repository: DocumentRepository = {
      list: vi.fn().mockResolvedValue([reference, leakedReference]),
      findById: vi.fn(),
    };

    const documents = await listAuthorizedDocuments(
      principal,
      scope,
      "case_alpha",
      caseRepository(),
      repository,
    );

    expect(documents).toEqual([
      {
        documentId: "doc_alpha",
        caseId: "case_alpha",
        sourceId: "DJEN",
        title: "Certidão de publicação",
        fileName: "certidao.pdf",
        mediaType: "application/pdf",
        collectedAt: "2026-08-29T12:00:00.000Z",
      },
    ]);
    expect(documents[0]).not.toHaveProperty("sourceUrl");
  });

  it("downloads only after authorizing both parent case and document", async () => {
    const repository: DocumentRepository = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(reference),
    };
    const downloaded = {
      bytes: new Uint8Array([37, 80, 68, 70]),
      mediaType: "application/pdf",
      sha256: "hash_alpha",
    };
    const client: DocumentClient = {
      download: vi.fn().mockResolvedValue(downloaded),
    };

    await expect(
      downloadAuthorizedDocument(
        principal,
        scope,
        "case_alpha",
        "doc_alpha",
        caseRepository(),
        repository,
        client,
      ),
    ).resolves.toEqual({ ...downloaded, fileName: "certidao.pdf" });
    expect(client.download).toHaveBeenCalledWith(reference);
  });

  it("hides leaked and missing document identifiers before network access", async () => {
    const leakedReference: DocumentReference = {
      ...reference,
      scope: foreignScope,
    };
    const repository: DocumentRepository = {
      list: vi.fn(),
      findById: vi
        .fn()
        .mockResolvedValueOnce(leakedReference)
        .mockResolvedValueOnce(undefined),
    };
    const client: DocumentClient = { download: vi.fn() };

    await expect(
      downloadAuthorizedDocument(
        principal,
        scope,
        "case_alpha",
        "doc_alpha",
        caseRepository(),
        repository,
        client,
      ),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(
      downloadAuthorizedDocument(
        principal,
        scope,
        "case_alpha",
        "doc_missing",
        caseRepository(),
        repository,
        client,
      ),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(client.download).not.toHaveBeenCalled();
  });

  it("does not query documents when the parent case is outside the scope", async () => {
    const repository: DocumentRepository = {
      list: vi.fn(),
      findById: vi.fn(),
    };

    await expect(
      listAuthorizedDocuments(
        principal,
        scope,
        "case_alpha",
        caseRepository({ ...canonicalCase, scope: foreignScope }),
        repository,
      ),
    ).rejects.toThrow("Processo não encontrado");
    expect(repository.list).not.toHaveBeenCalled();
  });
});
