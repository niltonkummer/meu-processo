import { describe, expect, it } from "vitest";

import type { DocumentReference } from "../application/document-gateway.js";
import { MemoryDocumentRepository } from "./memory-document-repository.js";

const reference: DocumentReference = {
  documentId: "doc_alpha",
  caseId: "case_alpha",
  scope: { kind: "personal", userId: "user_alpha" },
  sourceId: "DJEN",
  title: "Certidão",
  fileName: "certidao.pdf",
  mediaType: "application/pdf",
  sourceUrl: "https://documentos.tribunal.example/certidao.pdf",
  collectedAt: "2026-08-29T12:00:00.000Z",
};

describe("MemoryDocumentRepository", () => {
  it("isolates document list and detail by scope and parent case", async () => {
    const otherCase = { ...reference, documentId: "doc_other", caseId: "case_other" };
    const repository = new MemoryDocumentRepository([reference, otherCase]);

    await expect(repository.list(reference.scope, "case_alpha")).resolves.toEqual([
      reference,
    ]);
    await expect(
      repository.findById(reference.scope, "case_alpha", "doc_alpha"),
    ).resolves.toEqual(reference);
    await expect(
      repository.findById(reference.scope, "case_other", "doc_alpha"),
    ).resolves.toBeUndefined();
  });

  it("upserts by scope, case and document identity", async () => {
    const repository = new MemoryDocumentRepository();
    repository.upsert(reference);
    repository.upsert({ ...reference, title: "Certidão atualizada" });

    await expect(repository.list(reference.scope, "case_alpha")).resolves.toEqual([
      { ...reference, title: "Certidão atualizada" },
    ]);
  });
});
