import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  downloadPublicationCopy,
  SafePublicationCopyError,
} from "./publication-copy-client";

const cnj = "00000012320268990001";
const route = `/api/v1/processes/${cnj}/communications/321/publication-copy`;
const bytes = new TextEncoder().encode("%PDF-copy");
const sha256 = createHash("sha256").update(bytes).digest("hex");

const pdfResponse = (overrides: Record<string, string> = {}) =>
  new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(bytes.byteLength),
      "content-disposition": "attachment; filename=copy.pdf",
      "x-document-sha256": sha256,
      ...overrides,
    },
  });

describe("downloadPublicationCopy", () => {
  it("downloads and validates the authenticated PDF without trusting its filename", async () => {
    const fetcher = vi.fn().mockResolvedValue(pdfResponse());
    const result = await downloadPublicationCopy(fetcher, "token", cnj, 321);

    expect(fetcher).toHaveBeenCalledWith(route, {
      method: "GET",
      headers: { accept: "application/pdf", authorization: "Bearer token" },
      cache: "no-store",
      redirect: "error",
    });
    expect(result.fileName).toBe(
      "0000001-23.2026.8.99.0001-comunicacao-321-publicacao-djen.pdf",
    );
    expect(result.sha256).toBe(sha256);
    expect(result.blob.type).toBe("application/pdf");
  });

  it.each([
    ["", cnj, 321],
    ["x".repeat(8_193), cnj, 321],
    ["token", "invalid", 321],
    ["token", cnj, 0],
    ["token", cnj, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid local inputs", async (token, processNumber, communication) => {
    await expect(
      downloadPublicationCopy(vi.fn(), token, processNumber, communication),
    ).rejects.toBeInstanceOf(SafePublicationCopyError);
  });

  it("maps allowlisted API errors and hides untrusted responses", async () => {
    await expect(
      downloadPublicationCopy(
        vi.fn().mockResolvedValue(
          Response.json({ code: "PUBLICATION_TEXT_UNAVAILABLE" }, { status: 422 }),
        ),
        "token",
        cnj,
        321,
      ),
    ).rejects.toThrow("O texto oficial desta publicação não está disponível");

    await expect(
      downloadPublicationCopy(
        vi.fn().mockResolvedValue(new Response("upstream secret", { status: 502 })),
        "token",
        cnj,
        321,
      ),
    ).rejects.toThrow("Não foi possível preparar a cópia da publicação");

    for (const payload of ["string", null, { code: 123 }]) {
      await expect(
        downloadPublicationCopy(
          vi.fn().mockResolvedValue(Response.json(payload, { status: 502 })),
          "token",
          cnj,
          321,
        ),
      ).rejects.toThrow("Não foi possível preparar a cópia da publicação");
    }
  });

  it.each([
    [{ "content-type": "text/html" }],
    [{ "content-length": "4" }],
    [{ "content-length": String(25 * 1024 * 1024 + 1) }],
    [{ "content-length": "invalid" }],
    [{ "content-disposition": "inline" }],
    [{ "x-document-sha256": "invalid" }],
  ])("rejects unsafe response metadata", async (headers) => {
    await expect(
      downloadPublicationCopy(
        vi.fn().mockResolvedValue(pdfResponse(headers)),
        "token",
        cnj,
        321,
      ),
    ).rejects.toThrow("não passou pela validação de integridade");
  });

  it("rejects a body with a mismatched length, signature or hash", async () => {
    const responses = [
      pdfResponse({ "content-length": String(bytes.byteLength + 1) }),
      new Response(new TextEncoder().encode("xxxxx-copy"), {
        headers: {
          "content-type": "application/pdf",
          "content-length": "10",
          "content-disposition": "attachment",
          "x-document-sha256": sha256,
        },
      }),
      pdfResponse({ "x-document-sha256": "b".repeat(64) }),
    ];
    for (const response of responses) {
      await expect(
        downloadPublicationCopy(
          vi.fn().mockResolvedValue(response),
          "token",
          cnj,
          321,
        ),
      ).rejects.toThrow("não passou pela validação de integridade");
    }
  });

  it("rejects missing security headers", async () => {
    const variants = [
      {
        "content-length": String(bytes.byteLength),
        "content-disposition": "attachment",
        "x-document-sha256": sha256,
      },
      {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "x-document-sha256": sha256,
      },
      {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": "attachment",
      },
    ];
    for (const headers of variants) {
      await expect(
        downloadPublicationCopy(
          vi.fn().mockResolvedValue(new Response(bytes, { headers })),
          "token",
          cnj,
          321,
        ),
      ).rejects.toThrow("não passou pela validação de integridade");
    }
  });

  it("fails closed when transport or digest validation fails", async () => {
    await expect(
      downloadPublicationCopy(
        vi.fn().mockRejectedValue(new Error("network details")),
        "token",
        cnj,
        321,
      ),
    ).rejects.toThrow("Não foi possível preparar a cópia da publicação");

    await expect(
      downloadPublicationCopy(
        vi.fn().mockResolvedValue(pdfResponse()),
        "token",
        cnj,
        321,
        vi.fn().mockRejectedValue(new Error("digest details")),
      ),
    ).rejects.toThrow("não passou pela validação de integridade");
  });
});
