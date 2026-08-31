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
import type { MonitoringProfilesService } from "../application/monitoring-profiles.js";
import type { PersonalCasePortfolioService } from "../application/persisted-case-portfolio.js";
import {
  AlertNotFoundError,
  type PersonalAlertsService,
} from "../application/internal-alerts.js";
import {
  CaseTimelineNotFoundError,
  type PersonalCaseTimelineService,
} from "../application/persisted-case-timeline.js";
import {
  CaseDocumentsNotFoundError,
  type PersonalCaseDocumentsService,
} from "../application/persisted-case-documents.js";
import {
  DocumentContentUnavailableError,
  DocumentDownloadQuotaExceededError,
  PersistedDocumentNotFoundError,
  type PersonalDocumentDeliveryService,
} from "../application/individual-document-delivery.js";
import {
  DocumentMaterializationNotFoundError,
  DocumentMaterializationProjectionError,
  DocumentMaterializationRequestValidationError,
  type PersonalDocumentMaterializationRequestService,
} from "../application/document-materialization-request.js";
import {
  RepositoryAccessDeniedError,
  RepositoryConflictError,
} from "../application/foundation-repository.js";
import type { DjenClient } from "../application/types.js";
import {
  RecentAuthenticationRequiredError,
  type AccountDataControlsService,
} from "../application/account-data-controls.js";
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
    monitoringProfiles?: MonitoringProfilesService;
    casePortfolio?: PersonalCasePortfolioService;
    alerts?: PersonalAlertsService;
    caseTimeline?: PersonalCaseTimelineService;
    caseDocuments?: PersonalCaseDocumentsService;
    documentDelivery?: PersonalDocumentDeliveryService;
    documentMaterializationRequests?:
      PersonalDocumentMaterializationRequestService;
    accountDataControls?: AccountDataControlsService;
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
      officialIdentifier: "internal-source-reference",
    },
  ],
  events: [],
};

const publicPersonalCase = {
  caseId: personalCase.caseId,
  cnjNumber: personalCase.cnjNumber,
  tribunal: personalCase.tribunal,
  identityStatus: personalCase.identityStatus,
  lastUpdatedAt: personalCase.lastUpdatedAt,
  sources: personalCase.sources.map(({ sourceId, official, collectedAt }) => ({
    sourceId,
    official,
    collectedAt,
  })),
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
  it("requests, checks and downloads only the authenticated account export", async () => {
    const requestId = "20000000-0000-7000-8000-000000000001";
    const requestedAt = new Date("2026-08-31T12:00:00.000Z");
    const details = {
      requestId, requestType: "export" as const, state: "completed" as const,
      requestedAt, completedAt: requestedAt, artifactSizeBytes: 3,
      artifactExpiresAt: new Date("2099-09-01T12:00:00.000Z"),
      artifactObjectId: "private-locator-must-not-leak",
      artifactSha256: `sha256:${"a".repeat(64)}`,
    };
    const controls: AccountDataControlsService = {
      requestExport: vi.fn().mockResolvedValue({ ...details, state: "pending" }),
      get: vi.fn().mockResolvedValue(details),
      download: vi.fn().mockResolvedValue({ bytes: new Uint8Array([123, 125, 10]), fileName: `meu-processo-exportacao-${requestId}.json` }),
      requestDeletion: vi.fn().mockResolvedValue({ ...details, requestType: "deletion", state: "pending" }),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue({ ...principal, authenticatedAt: new Date() }) },
      requestRateLimiter: allowingRateLimiter(), accountDataControls: controls,
    });
    const headers = { authorization: "Bearer valid-private-token" };

    const created = await fetch(`${origin}/api/v1/account/data-exports`, { method: "POST", headers });
    const status = await fetch(`${origin}/api/v1/account/data-exports/${requestId}`, { headers });
    const downloaded = await fetch(`${origin}/api/v1/account/data-exports/${requestId}/download`, { headers });
    const deleted = await fetch(`${origin}/api/v1/account/deletion-requests`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "EXCLUIR MINHA CONTA" }),
    });

    expect(created.status).toBe(202);
    expect(status.status).toBe(200);
    const publicBody = JSON.stringify(await status.json());
    expect(publicBody).not.toContain("private-locator");
    expect(publicBody).not.toContain("sha256:");
    expect(downloaded.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(new Uint8Array([123, 125, 10]));
    expect(deleted.status).toBe(202);
    expect(controls.requestDeletion).toHaveBeenCalledWith(expect.objectContaining({
      providerSubject: principal.userId, confirmation: "EXCLUIR MINHA CONTA",
    }));
  });

  it("requires recent authentication for account deletion", async () => {
    const controls = {
      requestExport: vi.fn(), get: vi.fn(), download: vi.fn(),
      requestDeletion: vi.fn().mockRejectedValue(new RecentAuthenticationRequiredError()),
    } satisfies AccountDataControlsService;
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(), accountDataControls: controls,
    });
    const response = await fetch(`${origin}/api/v1/account/deletion-requests`, {
      method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "EXCLUIR MINHA CONTA" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
  });
  it("creates and lists minimized monitoring profiles for the verified identity", async () => {
    const subject = {
      tenantId: "10000000-0000-8000-8000-000000000001",
      subjectId: "20000000-0000-8000-8000-000000000001",
      subjectType: "name" as const,
      displayLabel: "P. S.",
      status: "active" as const,
      version: 1,
      archivedAt: null,
    };
    const publicSubject = {
      subjectId: subject.subjectId,
      subjectType: subject.subjectType,
      displayLabel: subject.displayLabel,
      status: subject.status,
      version: subject.version,
      archivedAt: subject.archivedAt,
    };
    const monitoringProfiles: MonitoringProfilesService = {
      create: vi.fn().mockResolvedValue(subject),
      list: vi.fn().mockResolvedValue({ items: [subject], nextCursor: null }),
      archive: vi.fn().mockResolvedValue({
        ...subject,
        status: "inactive",
        version: 2,
        archivedAt: new Date("2026-08-30T12:00:00.000Z"),
      }),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
      monitoringProfiles,
    });
    const headers = {
      authorization: "Bearer valid-private-token",
      "content-type": "application/json",
    };

    const created = await fetch(`${origin}/api/v1/monitoring/subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "name", value: "Pessoa Sintética" }),
    });
    const listed = await fetch(
      `${origin}/api/v1/monitoring/subjects?limit=20`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );
    const archived = await fetch(
      `${origin}/api/v1/monitoring/subjects/${subject.subjectId}`,
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer valid-private-token",
          "if-match": '"1"',
        },
      },
    );

    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    expect(await created.json()).toEqual({ subject: publicSubject });
    expect(await listed.json()).toEqual({ items: [publicSubject], nextCursor: null });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      subject: { subjectId: subject.subjectId, status: "inactive", version: 2 },
    });
    expect(monitoringProfiles.create).toHaveBeenCalledWith("user_alpha", {
      subjectType: "name",
      value: "Pessoa Sintética",
    });
    expect(monitoringProfiles.list).toHaveBeenCalledWith("user_alpha", {
      limit: 20,
    });
    expect(monitoringProfiles.archive).toHaveBeenCalledWith(
      "user_alpha",
      subject.subjectId,
      1,
    );

    const invalid = await fetch(`${origin}/api/v1/monitoring/subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "name", value: "Pessoa Sintética", admin: true }),
    });
    expect(invalid.status).toBe(400);
    expect(monitoringProfiles.create).toHaveBeenCalledTimes(1);
  });

  it("fails monitoring profile requests closed for auth, availability and invalid input", async () => {
    const unauthenticatedOrigin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockRejectedValue(new Error("invalid")) },
    });
    const unauthenticated = await fetch(
      `${unauthenticatedOrigin}/api/v1/monitoring/subjects`,
    );
    expect(unauthenticated.status).toBe(401);

    const unavailableOrigin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
    });
    const unavailable = await fetch(
      `${unavailableOrigin}/api/v1/monitoring/subjects`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );
    expect(unavailable.status).toBe(503);

    const monitoringProfiles: MonitoringProfilesService = {
      create: vi.fn().mockRejectedValue(new RepositoryConflictError()),
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      archive: vi.fn().mockRejectedValue(new RepositoryConflictError()),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
      monitoringProfiles,
    });
    const auth = { authorization: "Bearer valid-private-token" };
    const badPage = await fetch(
      `${origin}/api/v1/monitoring/subjects?limit=0&unknown=true`,
      { headers: auth },
    );
    const unsupported = await fetch(`${origin}/api/v1/monitoring/subjects`, {
      method: "POST",
      headers: auth,
      body: "type=name",
    });
    const conflict = await fetch(`${origin}/api/v1/monitoring/subjects`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ type: "name", value: "Pessoa Sintética" }),
    });
    expect(badPage.status).toBe(400);
    expect(unsupported.status).toBe(415);
    expect(conflict.status).toBe(409);
    const invalidArchive = await fetch(
      `${origin}/api/v1/monitoring/subjects/20000000-0000-8000-8000-000000000001`,
      { method: "DELETE", headers: auth },
    );
    expect(invalidArchive.status).toBe(400);

    const limitedOrigin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: { allow: vi.fn().mockReturnValue(false) },
      monitoringProfiles,
    });
    const limited = await fetch(
      `${limitedOrigin}/api/v1/monitoring/subjects`,
      { headers: auth },
    );
    expect(limited.status).toBe(429);
  });
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
    const previousOrigin = process.env.FIREBASE_AUTH_EMULATOR_BROWSER_ORIGIN;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "auth-emulator:9099";
    process.env.FIREBASE_AUTH_EMULATOR_BROWSER_ORIGIN =
      "http://127.0.0.1:19098";
    try {
      const origin = await start(emptyClient);
      const response = await fetch(`${origin}/health`);

      expect(response.headers.get("content-security-policy")).toContain(
        "http://127.0.0.1:19098",
      );

      process.env.FIREBASE_AUTH_EMULATOR_BROWSER_ORIGIN =
        "https://attacker.example";
      const rejectedOrigin = await start(emptyClient);
      const rejected = await fetch(`${rejectedOrigin}/health`);
      expect(rejected.headers.get("content-security-policy")).not.toContain(
        "attacker.example",
      );
    } finally {
      if (previous === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous;
      if (previousOrigin === undefined) {
        delete process.env.FIREBASE_AUTH_EMULATOR_BROWSER_ORIGIN;
      } else {
        process.env.FIREBASE_AUTH_EMULATOR_BROWSER_ORIGIN = previousOrigin;
      }
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

  it("lists and marks tenant alerts read through the authenticated API", async () => {
    const alert = {
      alertId: "90000000-0000-7000-8000-000000000801",
      subjectId: "20000000-0000-7000-8000-000000000801",
      subjectLabel: "Perfil sintético",
      tenantCaseId: "85000000-0000-7000-8000-000000000801",
      caseId: "83000000-0000-7000-8000-000000000801",
      caseEventId: "86000000-0000-7000-8000-000000000801",
      cnjNumber: "0000001-23.2026.8.99.0801",
      tribunal: "TJZZ",
      alertType: "case_discovered" as const,
      status: "unread" as const,
      matchStatus: "unverified" as const,
      sourceOccurredAt: "2026-08-31T10:00:00.000Z",
      createdAt: "2026-08-31T10:01:00.000Z",
      readAt: null,
    };
    const alerts: PersonalAlertsService = {
      list: vi.fn().mockResolvedValue({ items: [alert], nextCursor: "cursor-safe" }),
      markRead: vi.fn().mockResolvedValue({
        ...alert,
        status: "read",
        readAt: "2026-08-31T11:00:00.000Z",
      }),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
      alerts,
    });
    const headers = { authorization: "Bearer valid-private-token" };

    const listed = await fetch(`${origin}/api/v1/alerts?limit=1&status=unread`, { headers });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    expect(await listed.json()).toEqual({ items: [alert], nextCursor: "cursor-safe" });
    expect(alerts.list).toHaveBeenCalledWith("user_alpha", {
      limit: 1,
      status: "unread",
    });

    const read = await fetch(`${origin}/api/v1/alerts/${alert.alertId}/read`, {
      method: "PATCH",
      headers,
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ alert: { alertId: alert.alertId, status: "read" } });
    expect(alerts.markRead).toHaveBeenCalledWith("user_alpha", alert.alertId);
  });

  it("fails alert access closed for invalid, missing, denied and unavailable requests", async () => {
    const alerts: PersonalAlertsService = {
      list: vi.fn().mockRejectedValue(new RepositoryAccessDeniedError()),
      markRead: vi.fn().mockRejectedValue(new AlertNotFoundError()),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
      alerts,
    });
    const headers = { authorization: "Bearer valid-private-token" };
    expect((await fetch(`${origin}/api/v1/alerts?limit=0`, { headers })).status).toBe(400);
    expect((await fetch(`${origin}/api/v1/alerts`, { headers })).status).toBe(403);
    expect((await fetch(
      `${origin}/api/v1/alerts/90000000-0000-7000-8000-000000000801/read`,
      { method: "PATCH", headers },
    )).status).toBe(404);

    const unavailable = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
    });
    expect((await fetch(`${unavailable}/api/v1/alerts`, { headers })).status).toBe(503);
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
      cases: [publicPersonalCase],
      page: { nextCursor: null },
    });
    expect(verifier.verify).toHaveBeenCalledWith("valid-private-token");
    expect(repository.list).toHaveBeenCalledWith({
      kind: "personal",
      userId: "user_alpha",
    });
  });

  it("lists the persisted personal portfolio with validated cursor pagination", async () => {
    const cursor = "80000000-0000-7000-8000-000000000101";
    const casePortfolio = {
      list: vi.fn().mockResolvedValue({
        cases: [personalCase],
        nextCursor: cursor,
      }),
    } satisfies PersonalCasePortfolioService;
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      casePortfolio,
    });

    const response = await fetch(
      `${origin}/api/v1/cases?limit=1&after=70000000-0000-7000-8000-000000000101`,
      { headers: { authorization: "Bearer valid-private-token" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      cases: [publicPersonalCase],
      page: { nextCursor: cursor },
    });
    expect(casePortfolio.list).toHaveBeenCalledWith("user_alpha", {
      limit: 1,
      afterCaseId: "70000000-0000-7000-8000-000000000101",
    });

    for (const query of [
      "?unknown=1",
      "?limit=1&limit=2",
      "?limit=0",
      "?limit=1.5",
      "?limit=101",
      "?after=invalid",
    ]) {
      const invalid = await fetch(`${origin}/api/v1/cases${query}`, {
        headers: { authorization: "Bearer valid-private-token" },
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: "INVALID_CASE_PAGE" });
    }
    expect(casePortfolio.list).toHaveBeenCalledTimes(1);
  });

  it("lists the persisted case timeline with exact event context", async () => {
    const caseId = "83000000-0000-7000-8000-000000000901";
    const event = {
      eventId: "86000000-0000-7000-8000-000000000901",
      caseId,
      eventType: "publication" as const,
      occurredAt: "2026-08-31T09:00:00.000Z",
      title: "Intimação publicada",
      description: "Trecho seguro.",
      sources: [{ sourceId: "djen", official: true, collectedAt: "2026-08-31T10:00:00.000Z" }],
    };
    const caseTimeline: PersonalCaseTimelineService = {
      list: vi.fn().mockResolvedValue({ items: [event], nextCursor: "timeline-cursor" }),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseTimeline,
    });
    const headers = { authorization: "Bearer valid-private-token" };
    const response = await fetch(`${origin}/api/v1/cases/${caseId}/events?limit=1`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [event], page: { nextCursor: "timeline-cursor" } });
    expect(caseTimeline.list).toHaveBeenCalledWith("user_alpha", caseId, { limit: 1 });

    expect((await fetch(`${origin}/api/v1/cases/${caseId}/events?limit=0`, { headers })).status).toBe(400);
    caseTimeline.list = vi.fn().mockRejectedValue(new CaseTimelineNotFoundError());
    expect((await fetch(`${origin}/api/v1/cases/${caseId}/events`, { headers })).status).toBe(404);
  });

  it("lists safe persisted document metadata without requiring the legacy portfolio", async () => {
    const caseId = "83000000-0000-7000-8000-000000000901";
    const document = {
      documentId: "88000000-0000-7000-8000-000000000901",
      caseId,
      caseEventId: "86000000-0000-7000-8000-000000000901",
      title: "Intimação para manifestação",
      documentType: "intimacao",
      accessClass: "public_official" as const,
      availabilityStatus: "available" as const,
      expectedMediaType: "application/pdf" as const,
      sourceCreatedAt: "2026-08-31T09:00:00.000Z",
      lastVerifiedAt: "2026-08-31T10:00:00.000Z",
      source: { sourceId: "djen", official: true },
      artifact: {
        artifactId: "89000000-0000-7000-8000-000000000901",
        mediaType: "application/pdf" as const,
        sizeBytes: 2048,
        sha256: `sha256:${"a".repeat(64)}`,
        expiresAt: "2026-09-01T10:00:00.000Z",
      },
    };
    const caseDocuments: PersonalCaseDocumentsService = {
      list: vi.fn().mockResolvedValue({ items: [document], nextCursor: "document-cursor" }),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseDocuments,
    });
    const headers = { authorization: "Bearer valid-private-token" };
    const response = await fetch(
      `${origin}/api/v1/cases/${caseId}/documents?limit=1`, { headers },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      documents: [document], page: { nextCursor: "document-cursor" },
    });
    expect(caseDocuments.list).toHaveBeenCalledWith("user_alpha", caseId, { limit: 1 });

    for (const query of ["?unknown=1", "?limit=1&limit=2", "?limit=0", "?cursor=bad"]) {
      const invalid = await fetch(`${origin}/api/v1/cases/${caseId}/documents${query}`, { headers });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: "INVALID_DOCUMENT_PAGE" });
    }
    caseDocuments.list = vi.fn().mockRejectedValue(new CaseDocumentsNotFoundError());
    expect((await fetch(`${origin}/api/v1/cases/${caseId}/documents`, { headers })).status).toBe(404);
  });

  it("delivers a persisted PDF with renewed personal authorization and private headers", async () => {
    const caseId = "83000000-0000-7000-8000-000000000901";
    const documentId = "88000000-0000-7000-8000-000000000901";
    const bytes = new TextEncoder().encode("%PDF-1.7 persisted fixture");
    const documentDelivery: PersonalDocumentDeliveryService = {
      download: vi.fn().mockResolvedValue({
        bytes,
        mediaType: "application/pdf",
        sha256: `sha256:${"a".repeat(64)}`,
        fileName: "Decisão perigosa\".pdf",
      }),
    };
    const legacyClient: DocumentClient = { download: vi.fn() };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseDocuments: { list: vi.fn() },
      documentDelivery,
      documentClient: legacyClient,
      documentRepository: { list: vi.fn(), findById: vi.fn() },
    });
    const response = await fetch(
      `${origin}/api/v1/cases/${caseId}/documents/${documentId}/content`,
      { headers: { authorization: "Bearer fresh-token" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition"))
      .toBe('attachment; filename="Decisao_perigosa_.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(documentDelivery.download).toHaveBeenCalledWith(
      "user_alpha", caseId, documentId,
    );
    expect(legacyClient.download).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(await response.arrayBuffer())))
      .toEqual(Array.from(bytes));
  });

  it.each([
    [new PersistedDocumentNotFoundError(), 404, "DOCUMENT_NOT_FOUND"],
    [new DocumentDownloadQuotaExceededError(), 429, "DOCUMENT_DOWNLOAD_QUOTA_EXCEEDED"],
    [new DocumentContentUnavailableError(), 502, "DOCUMENT_CONTENT_UNAVAILABLE"],
  ])("maps persisted delivery failures without private detail", async (error, status, code) => {
    const caseId = "83000000-0000-7000-8000-000000000901";
    const documentId = "88000000-0000-7000-8000-000000000901";
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseDocuments: { list: vi.fn() },
      documentDelivery: { download: vi.fn().mockRejectedValue(error) },
    });
    const response = await fetch(
      `${origin}/api/v1/cases/${caseId}/documents/${documentId}/content`,
      { headers: { authorization: "Bearer fresh-token" } },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
  });

  it("rejects extra persisted download input and remains unavailable without an adapter", async () => {
    const caseId = "83000000-0000-7000-8000-000000000901";
    const documentId = "88000000-0000-7000-8000-000000000901";
    const privateApi = {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      caseDocuments: { list: vi.fn() },
    };
    const origin = await start(emptyClient, privateApi);
    const headers = { authorization: "Bearer fresh-token" };
    const unavailable = await fetch(
      `${origin}/api/v1/cases/${caseId}/documents/${documentId}/content`, { headers },
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: "DOCUMENT_DELIVERY_UNAVAILABLE" });

    const guardedOrigin = await start(emptyClient, {
      ...privateApi,
      documentDelivery: { download: vi.fn() },
    });
    const invalid = await fetch(
      `${guardedOrigin}/api/v1/cases/${caseId}/documents/${documentId}/content?path=secret`,
      { headers },
    );
    expect(invalid.status).toBe(404);
  });

  it("queues an authenticated document materialization with no client-controlled source", async () => {
    const caseId = "83000000-0000-7000-8000-000000000911";
    const documentId = "88000000-0000-7000-8000-000000000911";
    const result = {
      materializationId: "8c000000-0000-7000-8000-000000000911",
      documentId,
      state: "queued" as const,
    };
    const documentMaterializationRequests:
      PersonalDocumentMaterializationRequestService = {
        request: vi.fn().mockResolvedValue(result),
      };
    const requestRateLimiter = allowingRateLimiter();
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      documentMaterializationRequests,
      requestRateLimiter,
    });
    const response = await fetch(
      `${origin}/api/v1/cases/${caseId}/documents/${documentId}/materializations`,
      {
        method: "POST",
        headers: { authorization: "Bearer fresh-token" },
      },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result);
    expect(documentMaterializationRequests.request).toHaveBeenCalledWith(
      "user_alpha", caseId, documentId,
    );
    expect(requestRateLimiter.allow).toHaveBeenCalledWith(
      "document-materialization:user_alpha", 10, 60_000,
    );
  });

  it("authenticates, rate limits and fails closed when materialization is unavailable", async () => {
    const caseId = "83000000-0000-7000-8000-000000000912";
    const documentId = "88000000-0000-7000-8000-000000000912";
    const path = `/api/v1/cases/${caseId}/documents/${documentId}/materializations`;
    const unauthenticated = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockRejectedValue(new Error("invalid")) },
      requestRateLimiter: allowingRateLimiter(),
    });
    expect((await fetch(`${unauthenticated}${path}`, { method: "POST" })).status)
      .toBe(401);

    const unavailable = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
    });
    const unavailableResponse = await fetch(`${unavailable}${path}`, {
      method: "POST", headers: { authorization: "Bearer token" },
    });
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.json()).toMatchObject({
      code: "DOCUMENT_MATERIALIZATION_UNAVAILABLE",
    });

    const deniedLimiter: RequestRateLimiter = { allow: vi.fn().mockReturnValue(false) };
    const limited = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: deniedLimiter,
      documentMaterializationRequests: { request: vi.fn() },
    });
    expect((await fetch(`${limited}${path}`, {
      method: "POST", headers: { authorization: "Bearer token" },
    })).status).toBe(429);
  });

  it.each([
    [new DocumentMaterializationRequestValidationError(), 400,
      "INVALID_DOCUMENT_MATERIALIZATION_REQUEST"],
    [new DocumentMaterializationNotFoundError(), 404, "DOCUMENT_NOT_FOUND"],
    [new DocumentMaterializationProjectionError(), 503,
      "DOCUMENT_MATERIALIZATION_UNAVAILABLE"],
  ])("maps materialization failures without private detail", async (error, status, code) => {
    const caseId = "83000000-0000-7000-8000-000000000913";
    const documentId = "88000000-0000-7000-8000-000000000913";
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
      documentMaterializationRequests: {
        request: vi.fn().mockRejectedValue(error),
      },
    });
    const response = await fetch(
      `${origin}/api/v1/cases/${caseId}/documents/${documentId}/materializations`,
      { method: "POST", headers: { authorization: "Bearer token" } },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it("rejects materialization query, body and professional scope", async () => {
    const caseId = "83000000-0000-7000-8000-000000000914";
    const documentId = "88000000-0000-7000-8000-000000000914";
    const path = `/api/v1/cases/${caseId}/documents/${documentId}/materializations`;
    const service: PersonalDocumentMaterializationRequestService = {
      request: vi.fn(),
    };
    const origin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      requestRateLimiter: allowingRateLimiter(),
      documentMaterializationRequests: service,
    });
    const headers = { authorization: "Bearer token" };
    expect((await fetch(`${origin}${path}?source=external`, {
      method: "POST", headers,
    })).status).toBe(400);
    expect((await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
    })).status).toBe(400);
    expect((await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { ...headers, "x-organization-id": "org_alpha" },
    })).status).toBe(503);
    expect(service.request).not.toHaveBeenCalled();
  });

  it("fails the persisted portfolio closed for missing professional support and membership", async () => {
    const deniedPortfolio = {
      list: vi.fn().mockRejectedValue(new RepositoryAccessDeniedError()),
    } satisfies PersonalCasePortfolioService;
    const deniedOrigin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
      casePortfolio: deniedPortfolio,
    });
    const denied = await fetch(`${deniedOrigin}/api/v1/cases`, {
      headers: { authorization: "Bearer valid-private-token" },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });

    const organization = await fetch(`${deniedOrigin}/api/v1/cases`, {
      headers: {
        authorization: "Bearer valid-private-token",
        "x-organization-id": "org_alpha",
      },
    });
    expect(organization.status).toBe(503);
    expect(await organization.json()).toMatchObject({
      code: "CASE_PORTFOLIO_UNAVAILABLE",
    });

    const unavailableOrigin = await start(emptyClient, {
      tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
    });
    const unavailable = await fetch(`${unavailableOrigin}/api/v1/cases`, {
      headers: { authorization: "Bearer valid-private-token" },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      code: "CASE_PORTFOLIO_UNAVAILABLE",
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
      cases: [{
        ...publicPersonalCase,
        caseId: organizationCase.caseId,
      }],
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
