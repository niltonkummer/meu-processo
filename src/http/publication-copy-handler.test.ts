import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicationCopyPdfGenerator } from "../application/publication-copy.js";
import type { DjenPublicationLocator } from "../application/publication-proxy.js";
import type { RequestRateLimiter } from "../application/request-rate-limiter.js";
import type { DjenClient } from "../application/types.js";
import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import {
  DjenRateLimitError,
  DjenUpstreamError,
} from "../infrastructure/djen-client.js";
import { PublicationCopyGenerationError } from "../infrastructure/djen-publication-pdf.js";
import type { AppServerOptions } from "./private-api.js";
import { createAppServer } from "./server.js";

const servers: ReturnType<typeof createAppServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [],
};
const client: DjenClient = {
  search: vi.fn().mockResolvedValue({
    total: 0,
    truncated: false,
    publications: [],
  }),
};
const locator: DjenPublicationLocator = {
  findCommunication: vi.fn().mockResolvedValue({
    numeroProcesso: "0000001-23.2026.8.99.0001",
    numeroComunicacao: 321,
    texto: "Conteúdo oficial",
  }),
};
const generator: PublicationCopyPdfGenerator = {
  generate: vi.fn().mockResolvedValue({
    bytes: new TextEncoder().encode("%PDF-copy"),
    mediaType: "application/pdf",
    sha256: "a".repeat(64),
  }),
};
const limiter: RequestRateLimiter = { allow: vi.fn().mockReturnValue(true) };

const start = async (overrides: Partial<AppServerOptions> = {}) => {
  const server = createAppServer({
    client,
    tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
    publicationLocator: locator,
    publicationCopyPdfGenerator: generator,
    requestRateLimiter: limiter,
    ...overrides,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const route =
  "/api/v1/processes/00000012320268990001/communications/321/publication-copy";

describe("publication copy HTTP endpoint", () => {
  it("returns the authenticated, private PDF copy with integrity metadata", async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { authorization: "Bearer token" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-document-sha256")).toBe("a".repeat(64));
    expect(response.headers.get("content-disposition")).toContain(
      "0000001-23.2026.8.99.0001-comunicacao-321-publicacao-djen.pdf",
    );
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("%PDF-copy");
  });

  it("requires authentication and configured dependencies", async () => {
    const unauthenticated = await start({ tokenVerifier: undefined });
    expect((await fetch(`${unauthenticated}${route}`)).status).toBe(401);

    const unavailable = await start({ publicationCopyPdfGenerator: undefined });
    const response = await fetch(`${unavailable}${route}`, {
      headers: { authorization: "Bearer token" },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "PUBLICATION_COPY_UNAVAILABLE",
    });
  });

  it("rejects invalid references before reaching the source", async () => {
    const findCommunication = vi.fn();
    const baseUrl = await start({ publicationLocator: { findCommunication } });
    const response = await fetch(
      `${baseUrl}/api/v1/processes/invalid/communications/0/publication-copy`,
      { headers: { authorization: "Bearer token" } },
    );
    expect(response.status).toBe(400);
    expect(findCommunication).not.toHaveBeenCalled();
  });

  it("enforces the shared document rate limit", async () => {
    const baseUrl = await start({
      requestRateLimiter: { allow: vi.fn().mockReturnValue(false) },
    });
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { authorization: "Bearer token" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it.each([
    [undefined, undefined, 404, "PUBLICATION_NOT_FOUND"],
    [
      { numeroProcesso: "0000001-23.2026.8.99.0001", numeroComunicacao: 321 },
      undefined,
      422,
      "PUBLICATION_TEXT_UNAVAILABLE",
    ],
    [undefined, new DjenRateLimitError(), 429, "SOURCE_RATE_LIMITED"],
    [undefined, new DjenUpstreamError(), 502, "PUBLICATION_SOURCE_UNAVAILABLE"],
    [
      { numeroProcesso: "0000001-23.2026.8.99.0001", numeroComunicacao: 321, texto: "ok" },
      new PublicationCopyGenerationError(),
      502,
      "PUBLICATION_COPY_FAILED",
    ],
  ])(
    "maps expected source and generation failures",
    async (publication, failure, status, code) => {
      const findCommunication = failure instanceof DjenUpstreamError
        ? vi.fn().mockRejectedValue(failure)
        : vi.fn().mockResolvedValue(publication);
      const generate = failure instanceof PublicationCopyGenerationError
        ? vi.fn().mockRejectedValue(failure)
        : generator.generate;
      const baseUrl = await start({
        publicationLocator: { findCommunication },
        publicationCopyPdfGenerator: { generate },
      });
      const response = await fetch(`${baseUrl}${route}`, {
        headers: { authorization: "Bearer token" },
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
    },
  );
});
