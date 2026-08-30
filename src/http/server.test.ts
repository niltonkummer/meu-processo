import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaseRepository, CanonicalCase } from "../application/case-portfolio.js";
import type {
  DocumentClient,
  DocumentReference,
  DocumentRepository,
} from "../application/document-gateway.js";
import type { DjenPublicationLocator } from "../application/publication-proxy.js";
import type { RequestRateLimiter } from "../application/request-rate-limiter.js";
import type { DjenClient } from "../application/types.js";
import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import { DjenRateLimitError } from "../infrastructure/djen-client.js";
import {
  DocumentChallengeAnswerInvalidError,
  DocumentChallengeExpiredError,
  DocumentChallengeRequiredError,
  DocumentSourceRejectedError,
} from "../infrastructure/secure-document-client.js";
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

const start = async (
  client: DjenClient,
  privateApi?: {
    tokenVerifier: {
      verify(token: string): Promise<AuthenticatedPrincipal>;
    };
    caseRepository?: CaseRepository;
    documentRepository?: DocumentRepository;
    documentClient?: DocumentClient;
    publicationLocator?: DjenPublicationLocator;
    requestRateLimiter?: RequestRateLimiter;
  },
) => {
  const server = createAppServer({ client, ...privateApi });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [
    { organizationId: "org_alpha", role: "lawyer", active: true },
  ],
};

const allowingRateLimiter = (): RequestRateLimiter => ({
  allow: vi.fn().mockReturnValue(true),
});

const personalCase: CanonicalCase = {
  caseId: "case_alpha",
  scope: { kind: "personal", userId: "user_alpha" },
  cnjNumber: "0000001-23.2026.8.99.0001",
  tribunal: "TJEX",
  organ: "Vara de Exemplo",
  className: "Classe de Exemplo",
  identityStatus: "confirmed",
  lastUpdatedAt: "2026-08-29T12:00:00.000Z",
  sources: [
    {
      sourceId: "DJEN",
      official: true,
      collectedAt: "2026-08-29T12:00:00.000Z",
    },
  ],
  events: [],
};

const emptyClient: DjenClient = {
  search: vi.fn().mockResolvedValue({
    total: 0,
    truncated: false,
    publications: [],
  }),
};

const documentReference: DocumentReference = {
  documentId: "doc_alpha",
  caseId: "case_alpha",
  scope: { kind: "personal", userId: "user_alpha" },
  sourceId: "DJEN",
  title: "Certidão de publicação",
  fileName: "certidao.pdf",
  mediaType: "application/pdf",
  sourceUrl: "https://documentos.tribunal.example/certidao.pdf",
  collectedAt: "2026-08-29T12:00:00.000Z",
};

describe("HTTP server", () => {
  it("returns only the server-verified session and active memberships", async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(principal) };
    const origin = await start(emptyClient, { tokenVerifier: verifier });

    const response = await fetch(`${origin}/api/v1/session`, {
      headers: {
        authorization: "Bearer valid-private-token",
        "x-user-id": "user_attacker",
        "x-organization-id": "org_attacker",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      user: {
        userId: "user_alpha",
        memberships: [
          { organizationId: "org_alpha", role: "lawyer" },
        ],
      },
    });
    expect(verifier.verify).toHaveBeenCalledWith("valid-private-token");
  });

  it("denies the session endpoint without a valid bearer token", async () => {
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockRejectedValue(new Error("revoked")) },
    });

    const missing = await fetch(`${origin}/api/v1/session`);
    const malformed = await fetch(`${origin}/api/v1/session`, {
      headers: { authorization: "Basic not-a-token" },
    });
    const revoked = await fetch(`${origin}/api/v1/session`, {
      headers: { authorization: "Bearer revoked-token" },
    });

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
  });

  it("serves health publicly and requires authentication for versioned searches", async () => {
    const client: DjenClient = {
      search: vi.fn().mockResolvedValue({
        total: 0,
        truncated: false,
        publications: [],
      }),
    };
    const verifier = { verify: vi.fn().mockResolvedValue(principal) };
    const origin = await start(client, {
      tokenVerifier: verifier,
      requestRateLimiter: allowingRateLimiter(),
    });

    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(health.headers.get("content-security-policy")).toContain(
      "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    );

    const legacy = await fetch(`${origin}/api/searches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
    });
    expect(legacy.status).toBe(404);

    const unauthenticated = await fetch(`${origin}/api/v1/searches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(client.search).not.toHaveBeenCalled();

    const versionedResponse = await fetch(`${origin}/api/v1/searches`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-private-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
    });
    expect(versionedResponse.status).toBe(200);
    expect(versionedResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await versionedResponse.json()).toMatchObject({
      summary: { publications: 0, processes: 0 },
    });
  });

  it("allows the loopback Auth emulator in CSP only when local emulation is active", async () => {
    const previous = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "auth-emulator:9099";
    try {
      const origin = await start(emptyClient);
      const response = await fetch(`${origin}/health`);

      expect(response.headers.get("content-security-policy")).toContain(
        "http://127.0.0.1:9099",
      );
    } finally {
      if (previous === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous;
    }
  });

  it("returns safe errors for invalid input, invalid JSON and upstream failure", async () => {
    const client: DjenClient = {
      search: vi.fn().mockRejectedValue(new Error("private upstream detail")),
    };
    const origin = await start(client, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
    });
    const headers = {
      authorization: "Bearer valid-private-token",
      "content-type": "application/json",
    };

    const invalidInput = await fetch(`${origin}/api/v1/searches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "name", value: "Ana" }),
    });
    expect(invalidInput.status).toBe(400);
    expect(await invalidInput.json()).toMatchObject({ code: "INVALID_TARGET" });

    const invalidJson = await fetch(`${origin}/api/v1/searches`, {
      method: "POST",
      headers,
      body: "{",
    });
    expect(invalidJson.status).toBe(400);

    const upstreamFailure = await fetch(`${origin}/api/v1/searches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
    });
    expect(upstreamFailure.status).toBe(502);
    expect(await upstreamFailure.json()).toEqual({
      code: "SOURCE_UNAVAILABLE",
      message: "A fonte oficial não respondeu. Tente novamente mais tarde.",
    });
  });

  it("rejects unsupported routes and content types", async () => {
    const origin = await start(
      {
        search: vi.fn().mockResolvedValue({
          total: 0,
          truncated: false,
          publications: [],
        }),
      },
      {
        tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
        requestRateLimiter: allowingRateLimiter(),
      },
    );

    expect((await fetch(`${origin}/missing`)).status).toBe(404);
    expect(
      (
        await fetch(`${origin}/api/v1/searches`, {
          method: "POST",
          headers: { authorization: "Bearer valid-private-token" },
          body: "plain text",
        })
      ).status,
    ).toBe(415);
  });

  it("denies private API access by default and rejects invalid credentials", async () => {
    const withoutPrivateApi = await start(emptyClient);
    expect((await fetch(`${withoutPrivateApi}/api/v1/cases`)).status).toBe(401);

    const repository: CaseRepository = {
      list: vi.fn(),
      findById: vi.fn(),
    };
    const withPrivateApi = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockRejectedValue(new Error("invalid token")) },
      caseRepository: repository,
    });
    const response = await fetch(`${withPrivateApi}/api/v1/cases`, {
      headers: { authorization: "Bearer invalid-private-token" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("lists only cases in the authenticated personal scope", async () => {
    const leakedCase: CanonicalCase = {
      ...personalCase,
      caseId: "case_beta",
      scope: { kind: "personal", userId: "user_beta" },
    };
    const repository: CaseRepository = {
      list: vi.fn().mockResolvedValue([personalCase, leakedCase]),
      findById: vi.fn(),
    };
    const verifier = { verify: vi.fn().mockResolvedValue(principal) };
    const origin = await start(emptyClient, {
      tokenVerifier: verifier,
      caseRepository: repository,
    });

    const response = await fetch(`${origin}/api/v1/cases`, {
      headers: { authorization: "Bearer valid-private-token" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      cases: [personalCase],
      page: { nextCursor: null },
    });
    expect(verifier.verify).toHaveBeenCalledWith("valid-private-token");
    expect(repository.list).toHaveBeenCalledWith({
      kind: "personal",
      userId: "user_alpha",
    });
  });

  it("supports an active organization scope and denies a foreign organization", async () => {
    const organizationCase: CanonicalCase = {
      ...personalCase,
      caseId: "case_org",
      scope: { kind: "organization", organizationId: "org_alpha" },
    };
    const repository: CaseRepository = {
      list: vi.fn().mockResolvedValue([organizationCase]),
      findById: vi.fn(),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseRepository: repository,
    });

    const allowed = await fetch(`${origin}/api/v1/cases`, {
      headers: {
        authorization: "Bearer valid-private-token",
        "x-organization-id": "org_alpha",
      },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      cases: [organizationCase],
      page: { nextCursor: null },
    });

    const denied = await fetch(`${origin}/api/v1/cases`, {
      headers: {
        authorization: "Bearer valid-private-token",
        "x-organization-id": "org_foreign",
      },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it("returns a scoped case and hides leaked or missing case identifiers", async () => {
    const leakedCase: CanonicalCase = {
      ...personalCase,
      caseId: "case_beta",
      scope: { kind: "personal", userId: "user_beta" },
    };
    const repository: CaseRepository = {
      list: vi.fn(),
      findById: vi
        .fn()
        .mockResolvedValueOnce(personalCase)
        .mockResolvedValueOnce(leakedCase)
        .mockResolvedValueOnce(undefined),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseRepository: repository,
    });
    const headers = { authorization: "Bearer valid-private-token" };

    const found = await fetch(`${origin}/api/v1/cases/case_alpha`, { headers });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ case: personalCase });

    const leaked = await fetch(`${origin}/api/v1/cases/case_beta`, { headers });
    expect(leaked.status).toBe(404);
    expect(await leaked.json()).toMatchObject({ code: "CASE_NOT_FOUND" });

    const missing = await fetch(`${origin}/api/v1/cases/case_missing`, { headers });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "CASE_NOT_FOUND" });
  });

  it("returns events only after authorizing the parent case", async () => {
    const caseWithEvents: CanonicalCase = {
      ...personalCase,
      events: [
        {
          eventId: "event_alpha",
          occurredAt: "2026-08-28",
          title: "Publicação disponibilizada",
          description: "Descrição sintética de teste.",
          sourceId: "DJEN",
        },
      ],
    };
    const repository: CaseRepository = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(caseWithEvents),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseRepository: repository,
    });

    const response = await fetch(`${origin}/api/v1/cases/case_alpha/events`, {
      headers: { authorization: "Bearer valid-private-token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: caseWithEvents.events });
    expect(repository.findById).toHaveBeenCalledWith(
      { kind: "personal", userId: "user_alpha" },
      "case_alpha",
    );
  });

  it("lists document metadata without exposing its source location", async () => {
    const documentRepository: DocumentRepository = {
      list: vi.fn().mockResolvedValue([documentReference]),
      findById: vi.fn(),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseRepository: {
        list: vi.fn(),
        findById: vi.fn().mockResolvedValue(personalCase),
      },
      documentRepository,
    });

    const response = await fetch(`${origin}/api/v1/cases/case_alpha/documents`, {
      headers: { authorization: "Bearer valid-private-token" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      documents: [
        {
          documentId: "doc_alpha",
          caseId: "case_alpha",
          sourceId: "DJEN",
          title: "Certidão de publicação",
          fileName: "certidao.pdf",
          mediaType: "application/pdf",
          collectedAt: "2026-08-29T12:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("tribunal.example");
  });

  it("proxies an authorized PDF with only controlled response headers", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 synthetic fixture");
    const documentRepository: DocumentRepository = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        ...documentReference,
        fileName: "certidao perigosa\".pdf",
      }),
    };
    const documentClient: DocumentClient = {
      download: vi.fn().mockResolvedValue({
        bytes,
        mediaType: "application/pdf",
        sha256: "hash_alpha",
      }),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseRepository: {
        list: vi.fn(),
        findById: vi.fn().mockResolvedValue(personalCase),
      },
      documentRepository,
      documentClient,
    });

    const response = await fetch(
      `${origin}/api/v1/cases/case_alpha/documents/doc_alpha/content`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="certidao_perigosa_.pdf"',
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-document-sha256")).toBe("hash_alpha");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
      Array.from(bytes),
    );
  });

  it("fails closed when document dependencies or the source are unavailable", async () => {
    const privateApi = {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseRepository: {
        list: vi.fn(),
        findById: vi.fn().mockResolvedValue(personalCase),
      },
    };
    const withoutGateway = await start(emptyClient, privateApi);
    const unavailable = await fetch(
      `${withoutGateway}/api/v1/cases/case_alpha/documents`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );
    expect(unavailable.status).toBe(503);

    const withFailingSource = await start(emptyClient, {
      ...privateApi,
      documentRepository: {
        list: vi.fn(),
        findById: vi.fn().mockResolvedValue(documentReference),
      },
      documentClient: {
        download: vi.fn().mockRejectedValue(new Error("private upstream URL")),
      },
    });
    const failed = await fetch(
      `${withFailingSource}/api/v1/cases/case_alpha/documents/doc_alpha/content`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      code: "DOCUMENT_SOURCE_UNAVAILABLE",
      message: "O documento não pôde ser obtido da fonte oficial.",
    });
  });

  it("re-resolves and proxies an authenticated DJEN publication", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 official fixture");
    const publicationLocator: DjenPublicationLocator = {
      findCommunication: vi.fn().mockResolvedValue({
        id: 42,
        numeroProcesso: "0000001-23.2026.8.99.0001",
        numeroComunicacao: 98765,
        tipoDocumento: "Despacho",
        link: "https://eproc1g.tjrs.jus.br/eproc/documento.pdf",
      }),
    };
    const documentClient: DocumentClient = {
      download: vi.fn().mockResolvedValue({
        bytes,
        mediaType: "application/pdf",
        sha256: "hash_publication",
      }),
    };
    const limiter = allowingRateLimiter();
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator,
      documentClient,
      requestRateLimiter: limiter,
    });

    const response = await fetch(
      `${origin}/api/v1/processes/00000012320268990001/communications/98765/document`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="0000001-23.2026.8.99.0001-comunicacao-98765.pdf"',
    );
    expect(limiter.allow).toHaveBeenCalledWith(
      "document:user_alpha",
      20,
      60_000,
    );
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
      Array.from(bytes),
    );
  });

  it("returns a visual challenge and completes it through the authenticated proxy", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 assisted fixture");
    const publicationLocator: DjenPublicationLocator = {
      findCommunication: vi.fn().mockResolvedValue({
        numeroProcesso: "0000001-23.2026.8.99.0001",
        numeroComunicacao: 98765,
        link: "https://eproc1g.tjrs.jus.br/eproc/documento",
      }),
    };
    const completeChallenge = vi.fn().mockResolvedValue({
      bytes,
      mediaType: "application/pdf",
      sha256: "hash_assisted",
    });
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator,
      documentClient: {
        download: vi.fn().mockRejectedValue(
          new DocumentChallengeRequiredError(
            "challenge_alpha",
            "data:image/png;base64,iVBORw0KGgo=",
            "2026-08-30T12:02:00.000Z",
          ),
        ),
        completeChallenge,
      },
      requestRateLimiter: allowingRateLimiter(),
    });
    const path = `${origin}/api/v1/processes/00000012320268990001/communications/98765/document`;

    const challengeResponse = await fetch(path, {
      headers: { authorization: "Bearer valid-private-token" },
    });
    expect(challengeResponse.status).toBe(409);
    expect(await challengeResponse.json()).toEqual({
      code: "DOCUMENT_CHALLENGE_REQUIRED",
      message: "Digite o código exibido pelo tribunal para continuar.",
      challenge: {
        challengeId: "challenge_alpha",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        expiresAt: "2026-08-30T12:02:00.000Z",
      },
    });

    const completed = await fetch(`${path}/challenge`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-private-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ challengeId: "challenge_alpha", answer: "A19b" }),
    });
    expect(completed.status).toBe(200);
    expect(completed.headers.get("content-type")).toBe("application/pdf");
    expect(completeChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "00000012320268990001",
        scope: { kind: "personal", userId: "user_alpha" },
      }),
      { challengeId: "challenge_alpha", answer: "A19b" },
    );
  });

  it("validates assisted challenge requests before using the stored session", async () => {
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator: { findCommunication: vi.fn() },
      documentClient: { download: vi.fn(), completeChallenge: vi.fn() },
      requestRateLimiter: allowingRateLimiter(),
    });
    const path = `${origin}/api/v1/processes/00000012320268990001/communications/98765/document/challenge`;

    expect(
      (
        await fetch(path, {
          method: "POST",
          headers: { authorization: "Bearer valid-private-token" },
        })
      ).status,
    ).toBe(415);
    const incomplete = await fetch(path, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-private-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ challengeId: "challenge_alpha" }),
    });
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toMatchObject({
      code: "INVALID_CHALLENGE_REQUEST",
    });
    const invalidJson = await fetch(path, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-private-token",
        "content-type": "application/json",
      },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({
      code: "INVALID_CHALLENGE_REQUEST",
    });
  });

  it.each([
    [
      "expired",
      new DocumentChallengeExpiredError(),
      410,
      "DOCUMENT_CHALLENGE_EXPIRED",
    ],
    [
      "invalid answer",
      new DocumentChallengeAnswerInvalidError(),
      400,
      "INVALID_CHALLENGE_ANSWER",
    ],
  ])("maps an %s assisted challenge", async (_label, failure, status, code) => {
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator: {
        findCommunication: vi.fn().mockResolvedValue({
          numeroProcesso: "0000001-23.2026.8.99.0001",
          numeroComunicacao: 98765,
          link: "https://eproc1g.tjrs.jus.br/eproc/documento",
        }),
      },
      documentClient: {
        download: vi.fn(),
        completeChallenge: vi.fn().mockRejectedValue(failure),
      },
      requestRateLimiter: allowingRateLimiter(),
    });
    const response = await fetch(
      `${origin}/api/v1/processes/00000012320268990001/communications/98765/document/challenge`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer valid-private-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ challengeId: "challenge_alpha", answer: "A19b" }),
      },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it("fails closed when assisted challenge support is unavailable", async () => {
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator: { findCommunication: vi.fn() },
      documentClient: { download: vi.fn() },
      requestRateLimiter: allowingRateLimiter(),
    });
    const response = await fetch(
      `${origin}/api/v1/processes/00000012320268990001/communications/98765/document/challenge`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer valid-private-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ challengeId: "challenge_alpha", answer: "A19b" }),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "DOCUMENT_CHALLENGE_UNAVAILABLE",
    });
  });

  it("logs only a safe error category when an official publication is rejected", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator: {
        findCommunication: vi.fn().mockResolvedValue({
          numeroProcesso: "0000001-23.2026.8.99.0001",
          numeroComunicacao: 98765,
          link: "https://eproc1g.tjrs.jus.br/private-reference",
        }),
      },
      documentClient: {
        download: vi.fn().mockRejectedValue(
          new DocumentSourceRejectedError("html_wrapper_policy", {
            formCount: 1,
            postFormCount: 1,
            hiddenInputCount: 2,
            scriptCount: 1,
            anchorCount: 0,
            iframeCount: 0,
            embedCount: 0,
            objectCount: 0,
            metaRefreshCount: 0,
            sameHostFormActionCount: 1,
            setsCookie: true,
          }),
        ),
      },
      requestRateLimiter: allowingRateLimiter(),
    });

    const response = await fetch(
      `${origin}/api/v1/processes/00000012320268990001/communications/98765/document`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );

    expect(response.status).toBe(502);
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({
        severity: "WARNING",
        event: "publication_proxy_failed",
        errorName: "DocumentSourceRejectedError",
        errorReason: "html_wrapper_policy",
        safeContext: {
          formCount: 1,
          postFormCount: 1,
          hiddenInputCount: 2,
          scriptCount: 1,
          anchorCount: 0,
          iframeCount: 0,
          embedCount: 0,
          objectCount: 0,
          metaRefreshCount: 0,
          sameHostFormActionCount: 1,
          setsCookie: true,
        },
      }),
    );
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(
      "private-reference",
    );
    errorLog.mockRestore();
  });

  it("fails before the publication source for unauthenticated, invalid and limited requests", async () => {
    const publicationLocator: DjenPublicationLocator = {
      findCommunication: vi.fn(),
    };
    const documentClient: DocumentClient = { download: vi.fn() };
    const limiter: RequestRateLimiter = {
      allow: vi.fn().mockReturnValue(false),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      publicationLocator,
      documentClient,
      requestRateLimiter: limiter,
    });
    const path = `${origin}/api/v1/processes/00000012320268990001/communications/98765/document`;

    expect((await fetch(path)).status).toBe(401);
    expect(
      (
        await fetch(
          `${origin}/api/v1/processes/not-a-cnj/communications/98765/document`,
          { headers: { authorization: "Bearer valid-private-token" } },
        )
      ).status,
    ).toBe(400);
    const limited = await fetch(path, {
      headers: { authorization: "Bearer valid-private-token" },
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(publicationLocator.findCommunication).not.toHaveBeenCalled();
    expect(documentClient.download).not.toHaveBeenCalled();
  });

  it("maps the official DJEN rate limit without retrying", async () => {
    const search = vi.fn().mockRejectedValue(new DjenRateLimitError());
    const origin = await start(
      { search },
      {
        tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
        requestRateLimiter: allowingRateLimiter(),
      },
    );

    const response = await fetch(`${origin}/api/v1/searches`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-private-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "SOURCE_RATE_LIMITED" });
    expect(search).toHaveBeenCalledOnce();
  });
});
