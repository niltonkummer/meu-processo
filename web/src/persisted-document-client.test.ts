import { describe, expect, it, vi } from "vitest";

import {
  downloadPersistedDocument,
  listPersistedDocumentsPage,
  requestPersistedDocumentMaterialization,
  SafePersistedDocumentError,
  type PersistedCaseDocument,
} from "./persisted-document-client";

const CASE = "83000000-0000-7000-8000-000000000801";
const document = {
  documentId: "88000000-0000-7000-8000-000000000801",
  caseId: CASE,
  caseEventId: "86000000-0000-7000-8000-000000000801",
  title: "Intimação para manifestação",
  documentType: "intimacao",
  accessClass: "public_official",
  availabilityStatus: "available",
  expectedMediaType: "application/pdf",
  sourceCreatedAt: "2026-08-31T10:00:00.000Z",
  lastVerifiedAt: "2026-08-31T11:00:00.000Z",
  source: { sourceId: "djen", official: true },
  artifact: {
    artifactId: "89000000-0000-7000-8000-000000000801",
    mediaType: "application/pdf",
    sizeBytes: 2048,
    sha256: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-09-01T11:00:00.000Z",
  },
} satisfies PersistedCaseDocument;

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("persisted document client", () => {
  it.each(["queued", "processing", "available"] as const)(
    "requests an exact %s materialization without a request body",
    async (state) => {
      const materializationId = "8c000000-0000-7000-8000-000000000801";
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        materializationId,
        documentId: document.documentId,
        state,
      }, 202));
      await expect(requestPersistedDocumentMaterialization(
        fetcher, "fresh-token", CASE, document.documentId,
      )).resolves.toEqual({
        materializationId,
        documentId: document.documentId,
        state,
      });
      expect(fetcher).toHaveBeenCalledWith(
        `/api/v1/cases/${CASE}/documents/${document.documentId}/materializations`,
        {
          method: "POST",
          headers: { authorization: "Bearer fresh-token" },
          cache: "no-store",
          redirect: "error",
        },
      );
    },
  );

  it.each([
    { materializationId: "bad", documentId: document.documentId, state: "queued" },
    { materializationId: "8c000000-0000-7000-8000-000000000801",
      documentId: CASE, state: "queued" },
    { materializationId: "8c000000-0000-7000-8000-000000000801",
      documentId: document.documentId, state: "done" },
    { materializationId: "8c000000-0000-7000-8000-000000000801",
      documentId: document.documentId, state: "queued", sourceUrl: "forbidden" },
  ])("rejects an unsafe materialization projection", async (projection) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(projection, 202),
    );
    await expect(requestPersistedDocumentMaterialization(
      fetcher, "token", CASE, document.documentId,
    )).rejects.toEqual(new SafePersistedDocumentError(
      "INVALID_RESPONSE", "O servidor retornou documentos inesperados.",
    ));
  });

  it("bounds materialization failures and validates input before network access", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "DOCUMENT_NOT_FOUND", message: "Documento não encontrado.",
    }, 404));
    await expect(requestPersistedDocumentMaterialization(
      failed, "token", CASE, document.documentId,
    )).rejects.toEqual(new SafePersistedDocumentError(
      "DOCUMENT_NOT_FOUND", "Documento não encontrado.",
    ));
    const wrongSuccess = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      materializationId: "8c000000-0000-7000-8000-000000000801",
      documentId: document.documentId,
      state: "queued",
    }, 200));
    await expect(requestPersistedDocumentMaterialization(
      wrongSuccess, "token", CASE, document.documentId,
    )).rejects.toEqual(new SafePersistedDocumentError(
      "INVALID_RESPONSE", "O servidor retornou documentos inesperados.",
    ));
    const fetcher = vi.fn<typeof fetch>();
    for (const [token, caseId, documentId] of [
      ["", CASE, document.documentId],
      ["token", "bad", document.documentId],
      ["token", CASE, "bad"],
      ["bad\ncontrol", CASE, document.documentId],
    ] as const) {
      await expect(requestPersistedDocumentMaterialization(
        fetcher, token, caseId, documentId,
      )).rejects.toEqual(new SafePersistedDocumentError(
        "INVALID_REQUEST", "Não foi possível montar a consulta de documentos.",
      ));
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads only an exact PDF response for the requested persisted document", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF");
    const sha256 = `sha256:${"b".repeat(64)}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": "attachment; filename=document.pdf",
        "x-document-sha256": sha256,
      },
    }));
    const result = await downloadPersistedDocument(
      fetcher, "fresh-token", CASE, document.documentId,
      { sizeBytes: bytes.byteLength, sha256 },
    );
    expect({ ...result, bytes: Array.from(result.bytes) }).toEqual({
      bytes: Array.from(bytes),
      mediaType: "application/pdf",
      sha256,
      fileName: `documento-${document.documentId}.pdf`,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/cases/${CASE}/documents/${document.documentId}/content`,
      {
        headers: { authorization: "Bearer fresh-token" },
        cache: "no-store",
        redirect: "error",
      },
    );
  });

  it.each([
    ["mime", { "content-type": "text/html" }, "%PDF-1.7 valid"],
    ["length", { "content-length": "999" }, "%PDF-1.7 valid"],
    ["hash", { "x-document-sha256": `sha256:${"c".repeat(64)}` }, "%PDF-1.7 valid"],
    ["disposition", { "content-disposition": "inline" }, "%PDF-1.7 valid"],
    ["signature", {}, "<html>not pdf</html>"],
  ])("rejects an unsafe download response: %s", async (_name, override, body) => {
    const bytes = new TextEncoder().encode(body);
    const sha256 = `sha256:${"b".repeat(64)}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": "attachment; filename=document.pdf",
        "x-document-sha256": sha256,
        ...override,
      },
    }));
    await expect(downloadPersistedDocument(
      fetcher, "token", CASE, document.documentId,
      { sizeBytes: bytes.byteLength, sha256 },
    )).rejects.toEqual(new SafePersistedDocumentError(
      "INVALID_DOWNLOAD", "O arquivo recebido não corresponde ao documento solicitado.",
    ));
  });

  it("rejects a PDF response without an attachment disposition", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 valid");
    const sha256 = `sha256:${"b".repeat(64)}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "x-document-sha256": sha256,
      },
    }));
    await expect(downloadPersistedDocument(
      fetcher, "token", CASE, document.documentId,
      { sizeBytes: bytes.byteLength, sha256 },
    )).rejects.toEqual(new SafePersistedDocumentError(
      "INVALID_DOWNLOAD", "O arquivo recebido não corresponde ao documento solicitado.",
    ));
  });

  it("returns a bounded API failure and validates input before fetching", async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "DOCUMENT_DOWNLOAD_QUOTA_EXCEEDED",
      message: "Limite temporário de downloads atingido.",
    }, 429));
    await expect(downloadPersistedDocument(
      denied, "token", CASE, document.documentId,
      { sizeBytes: 100, sha256: `sha256:${"a".repeat(64)}` },
    )).rejects.toEqual(new SafePersistedDocumentError(
      "DOCUMENT_DOWNLOAD_QUOTA_EXCEEDED",
      "Limite temporário de downloads atingido.",
    ));
    const fetcher = vi.fn<typeof fetch>();
    for (const [token, caseId, documentId, artifact] of [
      ["", CASE, document.documentId, { sizeBytes: 100, sha256: `sha256:${"a".repeat(64)}` }],
      ["token", "bad", document.documentId, { sizeBytes: 100, sha256: `sha256:${"a".repeat(64)}` }],
      ["token", CASE, "bad", { sizeBytes: 100, sha256: `sha256:${"a".repeat(64)}` }],
      ["token", CASE, document.documentId, { sizeBytes: 0, sha256: `sha256:${"a".repeat(64)}` }],
      ["token", CASE, document.documentId, { sizeBytes: 100, sha256: "bad" }],
    ] as const) {
      await expect(downloadPersistedDocument(
        fetcher, token, caseId, documentId, artifact,
      )).rejects.toEqual(new SafePersistedDocumentError(
        "INVALID_REQUEST", "Não foi possível montar a consulta de documentos.",
      ));
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("lists an exact, safe document page", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      documents: [document], page: { nextCursor: "document_cursor-1" },
    }));
    await expect(listPersistedDocumentsPage(fetcher, "token", CASE, {
      limit: 20,
      cursor: "document_cursor-0",
    })).resolves.toEqual({ items: [document], nextCursor: "document_cursor-1" });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/cases/${CASE}/documents?limit=20&cursor=document_cursor-0`,
      { headers: { authorization: "Bearer token" } },
    );
  });

  it("accepts metadata without event, type or materialized artifact", async () => {
    const metadata = {
      ...document,
      caseEventId: null,
      documentType: null,
      availabilityStatus: "metadata_only" as const,
      artifact: null,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      documents: [metadata], page: { nextCursor: null },
    }));
    await expect(listPersistedDocumentsPage(fetcher, "token", CASE, { limit: 20 }))
      .resolves.toEqual({ items: [metadata], nextCursor: null });
  });

  it.each([
    ["non-object", "invalid"],
    ["extra field", { ...document, storageObjectId: "forbidden" }],
    ["document id", { ...document, documentId: "bad" }],
    ["foreign case", { ...document, caseId: "83000000-0000-7000-8000-000000000999" }],
    ["event id", { ...document, caseEventId: "bad" }],
    ["title", { ...document, title: "" }],
    ["type", { ...document, documentType: "Invalid type" }],
    ["access", { ...document, accessClass: "secret" }],
    ["availability", { ...document, availabilityStatus: "ready" }],
    ["expected mime", { ...document, expectedMediaType: "text/html" }],
    ["source date", { ...document, sourceCreatedAt: "bad" }],
    ["verification date type", { ...document, lastVerifiedAt: 12 }],
    ["verification before source", { ...document, lastVerifiedAt: "2026-08-31T09:00:00Z" }],
    ["source extra", { ...document, source: { ...document.source, url: "forbidden" } }],
    ["source id", { ...document, source: { ...document.source, sourceId: "" } }],
    ["source official", { ...document, source: { ...document.source, official: "yes" } }],
    ["artifact id", { ...document, artifact: { ...document.artifact, artifactId: "bad" } }],
    ["artifact mime", { ...document, artifact: { ...document.artifact, mediaType: "text/html" } }],
    ["artifact size", { ...document, artifact: { ...document.artifact, sizeBytes: 0 } }],
    ["artifact hash", { ...document, artifact: { ...document.artifact, sha256: "bad" } }],
    ["artifact expiry", { ...document, artifact: { ...document.artifact, expiresAt: "bad" } }],
    ["artifact with non-ready metadata", { ...document, availabilityStatus: "expired" }],
  ])("rejects an invalid document: %s", async (_name, invalid) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      documents: [invalid], page: { nextCursor: null },
    }));
    await expect(listPersistedDocumentsPage(fetcher, "token", CASE, { limit: 20 }))
      .rejects.toBeInstanceOf(SafePersistedDocumentError);
  });

  it("rejects malformed envelopes, duplicates, cursors and invalid JSON", async () => {
    for (const body of [
      "invalid",
      { documents: "invalid", page: { nextCursor: null } },
      { documents: [], page: null },
      { documents: [], page: { nextCursor: "bad cursor!" } },
      { documents: [], page: { nextCursor: null, extra: true } },
      { documents: [document, document], page: { nextCursor: null } },
      { documents: [], page: { nextCursor: null }, extra: true },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expect(listPersistedDocumentsPage(fetcher, "token", CASE, { limit: 20 }))
        .rejects.toBeInstanceOf(SafePersistedDocumentError);
    }
    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json"));
    await expect(listPersistedDocumentsPage(invalidJson, "token", CASE, { limit: 20 }))
      .rejects.toBeInstanceOf(SafePersistedDocumentError);
  });

  it("returns only bounded API failures", async () => {
    const safe = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "DOCUMENTS_UNAVAILABLE", message: "Documentos indisponíveis.",
    }, 503));
    await expect(listPersistedDocumentsPage(safe, "token", CASE, { limit: 20 }))
      .rejects.toEqual(new SafePersistedDocumentError(
        "DOCUMENTS_UNAVAILABLE", "Documentos indisponíveis.",
      ));
    for (const body of ["failed", { code: "", message: "bad" }, { code: "X", message: "m".repeat(241) }]) {
      const unsafe = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, 500));
      await expect(listPersistedDocumentsPage(unsafe, "token", CASE, { limit: 20 }))
        .rejects.toEqual(new SafePersistedDocumentError(
          "DOCUMENTS_FAILED", "Não foi possível carregar os documentos.",
        ));
    }
  });

  it("rejects invalid requests before network access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const [caseId, request] of [
      ["bad", { limit: 20 }],
      [CASE, { limit: 0 }],
      [CASE, { limit: 1.5 }],
      [CASE, { limit: 101 }],
      [CASE, { limit: 20, cursor: "bad!" }],
    ] as const) {
      await expect(listPersistedDocumentsPage(fetcher, "token", caseId, request))
        .rejects.toEqual(new SafePersistedDocumentError(
          "INVALID_REQUEST", "Não foi possível montar a consulta de documentos.",
        ));
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
