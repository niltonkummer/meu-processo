import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import { WebSocket, WebSocketServer } from "ws";

import {
  AssistedDocumentSession,
  type AssistedRendererConnector,
} from "../application/assisted-document-session.js";
import {
  getAuthorizedCase,
  listAuthorizedCases,
  PortfolioAccessDeniedError,
  PortfolioCaseNotFoundError,
  type CaseRepository,
} from "../application/case-portfolio.js";
import type { TokenVerifier } from "../application/authentication.js";
import {
  downloadAuthorizedDocument,
  listAuthorizedDocuments,
  DocumentNotFoundError,
  type DocumentClient,
  type DocumentRepository,
} from "../application/document-gateway.js";
import {
  completeAuthorizedPublicationChallenge,
  openAuthorizedPublication,
  parsePublicationReference,
  PublicationChallengeUnavailableError,
  PublicationNotFoundError,
  PublicationReferenceInvalidError,
  type DjenPublicationLocator,
} from "../application/publication-proxy.js";
import type { RequestRateLimiter } from "../application/request-rate-limiter.js";
import { searchProcesses } from "../application/search-processes.js";
import type { DjenClient } from "../application/types.js";
import type {
  AuthenticatedPrincipal,
  TenantScope,
} from "../domain/access-control.js";
import { TargetValidationError } from "../domain/search-target.js";
import { DjenRateLimitError } from "../infrastructure/djen-client.js";
import {
  DocumentChallengeAnswerInvalidError,
  DocumentChallengeExpiredError,
  DocumentChallengeRequiredError,
  DocumentSourceRejectedError,
} from "../infrastructure/secure-document-client.js";
import { websocketDataToText } from "../infrastructure/websocket-data.js";

const MAX_BODY_BYTES = 16_384;
const RATE_WINDOW_MS = 60_000;
const SEARCH_RATE_LIMIT = 10;
const DOCUMENT_RATE_LIMIT = 20;

const applySecurityHeaders = (response: ServerResponse) => {
  const authEmulatorSource = process.env.FIREBASE_AUTH_EMULATOR_HOST
    ? " http://127.0.0.1:9099"
    : "";
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.setHeader(
    "content-security-policy",
    `default-src 'self'; base-uri 'none'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com${authEmulatorSource}; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'`,
  );
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  cacheControl = "no-store",
) => {
  applySecurityHeaders(response);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheControl,
  });
  response.end(JSON.stringify(payload));
};

interface PrivateApiDependencies {
  tokenVerifier?: TokenVerifier | undefined;
  caseRepository?: CaseRepository | undefined;
  documentRepository?: DocumentRepository | undefined;
  documentClient?: DocumentClient | undefined;
  publicationLocator?: DjenPublicationLocator | undefined;
  requestRateLimiter?: RequestRateLimiter | undefined;
  rendererConnector?: AssistedRendererConnector | undefined;
}

const scheduleSessionTimeout = (
  callback: () => void,
  delayMs: number,
): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

const parseDocumentSessionPath = (
  rawUrl: string | undefined,
): { cnjNumber: string; communicationNumber: string } | undefined => {
  const pathname = new URL(rawUrl ?? "/", "http://localhost").pathname;
  const match = /^\/api\/v1\/processes\/(\d{20})\/communications\/([1-9]\d*)\/document\/session$/.exec(
    pathname,
  );
  return match?.[1] && match[2]
    ? { cnjNumber: match[1], communicationNumber: match[2] }
    : undefined;
};

const rejectUpgrade = (
  socket: import("node:stream").Duplex,
  statusCode: number,
  statusText: string,
) => {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
};

const sendPrivateJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => sendJson(response, statusCode, payload, "private, no-store");

const safePdfFileName = (fileName: string): string => {
  const sanitized = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return sanitized.length > 0 ? sanitized : "documento.pdf";
};

const sendPrivateDocument = (
  response: ServerResponse,
  document: {
    bytes: Uint8Array;
    mediaType: "application/pdf";
    sha256: string;
    fileName: string;
  },
) => {
  applySecurityHeaders(response);
  response.setHeader(
    "content-security-policy",
    "sandbox; default-src 'none'; frame-ancestors 'none'",
  );
  response.writeHead(200, {
    "content-type": document.mediaType,
    "content-length": String(document.bytes.byteLength),
    "content-disposition": `attachment; filename="${safePdfFileName(document.fileName)}"`,
    "cache-control": "private, no-store",
    "x-document-sha256": document.sha256,
  });
  response.end(document.bytes);
};

const authenticate = async (
  request: IncomingMessage,
  tokenVerifier: TokenVerifier | undefined,
): Promise<AuthenticatedPrincipal | undefined> => {
  if (!tokenVerifier) return undefined;

  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return undefined;

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) return undefined;

  try {
    return await tokenVerifier.verify(match[1]);
  } catch {
    return undefined;
  }
};

const resolveScope = (
  request: IncomingMessage,
  principal: AuthenticatedPrincipal,
): TenantScope => {
  const organizationId = request.headers["x-organization-id"];
  return typeof organizationId === "string" && organizationId.length > 0
    ? { kind: "organization", organizationId }
    : { kind: "personal", userId: principal.userId };
};

const sendRateLimited = (
  response: ServerResponse,
  code = "RATE_LIMITED",
) => {
  applySecurityHeaders(response);
  response.writeHead(429, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "retry-after": "60",
  });
  response.end(
    JSON.stringify({
      code,
      message: "Limite temporário atingido. Aguarde um minuto.",
    }),
  );
};

const handlePublicationProxy = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: PrivateApiDependencies,
): Promise<boolean> => {
  const segments = pathname.split("/").filter(Boolean);
  const isInitialRequest =
    request.method === "GET" &&
    segments.length === 7 &&
    segments[0] === "api" &&
    segments[1] === "v1" &&
    segments[2] === "processes" &&
    segments[4] === "communications" &&
    segments[6] === "document";
  const isChallengeResponse =
    request.method === "POST" &&
    segments.length === 8 &&
    segments[0] === "api" &&
    segments[1] === "v1" &&
    segments[2] === "processes" &&
    segments[4] === "communications" &&
    segments[6] === "document" &&
    segments[7] === "challenge";
  if (!isInitialRequest && !isChallengeResponse) return false;

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }

  if (
    !dependencies.publicationLocator ||
    !dependencies.documentClient ||
    !dependencies.requestRateLimiter
  ) {
    sendPrivateJson(response, 503, {
      code: "PUBLICATION_PROXY_UNAVAILABLE",
      message: "O proxy de publicações não está configurado.",
    });
    return true;
  }

  const requestedCnj = segments[3] ?? "";
  const requestedCommunication = segments[5] ?? "";
  try {
    parsePublicationReference(requestedCnj, requestedCommunication);
  } catch (error) {
    if (error instanceof PublicationReferenceInvalidError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_PUBLICATION_REFERENCE",
        message: "A referência da publicação é inválida.",
      });
      return true;
    }
    throw error;
  }

  if (
    !dependencies.requestRateLimiter.allow(
      `document:${principal.userId}`,
      DOCUMENT_RATE_LIMIT,
      RATE_WINDOW_MS,
    )
  ) {
    sendRateLimited(response);
    return true;
  }

  try {
    let document;
    if (isChallengeResponse) {
      if (
        !request.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        sendPrivateJson(response, 415, {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Envie o código como application/json.",
        });
        return true;
      }
      const body = await readJsonBody(request);
      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as Record<string, unknown>).challengeId !== "string" ||
        typeof (body as Record<string, unknown>).answer !== "string"
      ) {
        sendPrivateJson(response, 400, {
          code: "INVALID_CHALLENGE_REQUEST",
          message: "Informe o identificador e o código de segurança.",
        });
        return true;
      }
      const challengeBody = body as {
        challengeId: string;
        answer: string;
      };
      document = await completeAuthorizedPublicationChallenge(
        principal,
        requestedCnj,
        requestedCommunication,
        challengeBody,
        dependencies.publicationLocator,
        dependencies.documentClient,
      );
    } else {
      document = await openAuthorizedPublication(
        principal,
        requestedCnj,
        requestedCommunication,
        dependencies.publicationLocator,
        dependencies.documentClient,
      );
    }
    sendPrivateDocument(response, document);
  } catch (error) {
    if (error instanceof PublicationNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "PUBLICATION_NOT_FOUND",
        message: "Publicação não encontrada.",
      });
      return true;
    }
    if (error instanceof DjenRateLimitError) {
      sendRateLimited(response, "SOURCE_RATE_LIMITED");
      return true;
    }
    if (error instanceof DocumentChallengeRequiredError) {
      sendPrivateJson(response, 409, {
        code: "DOCUMENT_CHALLENGE_REQUIRED",
        message: "Digite o código exibido pelo tribunal para continuar.",
        challenge: {
          challengeId: error.challengeId,
          imageDataUrl: error.imageDataUrl,
          expiresAt: error.expiresAt,
        },
      });
      return true;
    }
    if (error instanceof DocumentChallengeExpiredError) {
      sendPrivateJson(response, 410, {
        code: "DOCUMENT_CHALLENGE_EXPIRED",
        message: "O código expirou. Solicite uma nova imagem.",
      });
      return true;
    }
    if (error instanceof DocumentChallengeAnswerInvalidError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_CHALLENGE_ANSWER",
        message: "Use apenas letras e números no código de segurança.",
      });
      return true;
    }
    if (error instanceof PublicationChallengeUnavailableError) {
      sendPrivateJson(response, 503, {
        code: "DOCUMENT_CHALLENGE_UNAVAILABLE",
        message: "O fluxo assistido não está disponível.",
      });
      return true;
    }
    if (error instanceof TargetValidationError && isChallengeResponse) {
      sendPrivateJson(response, 400, {
        code: "INVALID_CHALLENGE_REQUEST",
        message: "Não foi possível ler o código de segurança.",
      });
      return true;
    }
    console.error(
      JSON.stringify({
        severity: "WARNING",
        event: "publication_proxy_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof DocumentSourceRejectedError
          ? {
              errorReason: error.reason,
              ...(error.safeContext
                ? { safeContext: error.safeContext }
                : {}),
            }
          : {}),
      }),
    );
    sendPrivateJson(response, 502, {
      code: "PUBLICATION_SOURCE_UNAVAILABLE",
      message: "A publicação não pôde ser obtida da fonte oficial.",
    });
  }
  return true;
};

const handleAuthenticatedSearch = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  client: DjenClient,
  dependencies: PrivateApiDependencies,
): Promise<boolean> => {
  if (request.method !== "POST" || pathname !== "/api/v1/searches") {
    return false;
  }

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }
  if (!dependencies.requestRateLimiter) {
    sendPrivateJson(response, 503, {
      code: "SEARCH_UNAVAILABLE",
      message: "A consulta não está disponível.",
    });
    return true;
  }
  if (
    !dependencies.requestRateLimiter.allow(
      `search:${principal.userId}`,
      SEARCH_RATE_LIMIT,
      RATE_WINDOW_MS,
    )
  ) {
    sendRateLimited(response);
    return true;
  }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    sendPrivateJson(response, 415, {
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Envie o corpo como application/json.",
    });
    return true;
  }

  try {
    const input = await readJsonBody(request);
    const result = await searchProcesses(input, client);
    sendPrivateJson(response, 200, result);
  } catch (error) {
    if (error instanceof TargetValidationError) {
      sendPrivateJson(response, 400, { code: error.code, message: error.message });
      return true;
    }
    if (error instanceof DjenRateLimitError) {
      sendRateLimited(response, "SOURCE_RATE_LIMITED");
      return true;
    }
    sendPrivateJson(response, 502, {
      code: "SOURCE_UNAVAILABLE",
      message: "A fonte oficial não respondeu. Tente novamente mais tarde.",
    });
  }
  return true;
};

const handlePrivateCases = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: PrivateApiDependencies,
): Promise<boolean> => {
  const isCollection = pathname === "/api/v1/cases";
  const pathSegments = pathname.split("/").filter(Boolean);
  const isCaseDetail =
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases";
  const isEvents =
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "events";
  const isDocumentCollection =
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "documents";
  const isDocumentContent =
    pathSegments.length === 7 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "documents" &&
    pathSegments[6] === "content";
  if (
    request.method !== "GET" ||
    (!isCollection &&
      !isCaseDetail &&
      !isEvents &&
      !isDocumentCollection &&
      !isDocumentContent)
  ) {
    return false;
  }

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal || !dependencies.caseRepository) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }

  const scope = resolveScope(request, principal);
  try {
    if (isCollection) {
      const cases = await listAuthorizedCases(
        principal,
        scope,
        dependencies.caseRepository,
      );
      sendPrivateJson(response, 200, {
        cases,
        page: { nextCursor: null },
      });
      return true;
    }

    const caseId = pathSegments[3] ?? "";
    if (isDocumentCollection) {
      if (!dependencies.documentRepository) {
        sendPrivateJson(response, 503, {
          code: "DOCUMENT_GATEWAY_UNAVAILABLE",
          message: "O gateway de documentos não está configurado.",
        });
        return true;
      }
      const documents = await listAuthorizedDocuments(
        principal,
        scope,
        caseId,
        dependencies.caseRepository,
        dependencies.documentRepository,
      );
      sendPrivateJson(response, 200, { documents });
      return true;
    }

    if (isDocumentContent) {
      if (!dependencies.documentRepository || !dependencies.documentClient) {
        sendPrivateJson(response, 503, {
          code: "DOCUMENT_GATEWAY_UNAVAILABLE",
          message: "O gateway de documentos não está configurado.",
        });
        return true;
      }
      const documentId = pathSegments[5] ?? "";
      const document = await downloadAuthorizedDocument(
        principal,
        scope,
        caseId,
        documentId,
        dependencies.caseRepository,
        dependencies.documentRepository,
        dependencies.documentClient,
      );
      sendPrivateDocument(response, document);
      return true;
    }

    const foundCase = await getAuthorizedCase(
      principal,
      scope,
      caseId,
      dependencies.caseRepository,
    );
    sendPrivateJson(
      response,
      200,
      isEvents ? { events: foundCase.events } : { case: foundCase },
    );
  } catch (error) {
    if (error instanceof PortfolioAccessDeniedError) {
      sendPrivateJson(response, 403, {
        code: "FORBIDDEN",
        message: "Acesso negado.",
      });
      return true;
    }
    if (
      error instanceof DocumentNotFoundError ||
      ((isDocumentCollection || isDocumentContent) &&
        error instanceof PortfolioCaseNotFoundError)
    ) {
      sendPrivateJson(response, 404, {
        code: "DOCUMENT_NOT_FOUND",
        message: "Documento não encontrado.",
      });
      return true;
    }
    if (error instanceof PortfolioCaseNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "CASE_NOT_FOUND",
        message: "Processo não encontrado.",
      });
      return true;
    }
    if (isDocumentContent) {
      sendPrivateJson(response, 502, {
        code: "DOCUMENT_SOURCE_UNAVAILABLE",
        message: "O documento não pôde ser obtido da fonte oficial.",
      });
      return true;
    }
    throw error;
  }

  return true;
};

const handlePrivateSession = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  tokenVerifier: TokenVerifier | undefined,
): Promise<boolean> => {
  if (request.method !== "GET" || pathname !== "/api/v1/session") return false;

  const principal = await authenticate(request, tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }

  sendPrivateJson(response, 200, {
    user: {
      userId: principal.userId,
      memberships: principal.memberships
        .filter((membership) => membership.active)
        .map(({ organizationId, role }) => ({ organizationId, role })),
    },
  });
  return true;
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new TargetValidationError("Requisição muito grande.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new TargetValidationError("JSON inválido.");
  }
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const serveStatic = (
  pathname: string,
  webRoot: string,
  response: ServerResponse,
) => {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const root = resolve(webRoot);
  const candidate = resolve(join(root, normalize(requested)));
  if (!candidate.startsWith(`${root}/`) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    return false;
  }

  applySecurityHeaders(response);
  response.writeHead(200, {
    "content-type": contentTypes[extname(candidate)] ?? "application/octet-stream",
    "cache-control": candidate.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  createReadStream(candidate).pipe(response);
  return true;
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  client: DjenClient,
  webRoot: string | undefined,
  privateApi: PrivateApiDependencies,
) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  // Cloud Run reserves the exact external path /healthz, so keep the public
  // health contract on /health even though either path works inside a container.
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (
    await handlePrivateSession(
      request,
      response,
      url.pathname,
      privateApi.tokenVerifier,
    )
  ) {
    return;
  }

  if (await handlePublicationProxy(request, response, url.pathname, privateApi)) {
    return;
  }

  if (await handlePrivateCases(request, response, url.pathname, privateApi)) {
    return;
  }

  if (
    await handleAuthenticatedSearch(
      request,
      response,
      url.pathname,
      client,
      privateApi,
    )
  ) {
    return;
  }

  if (request.method === "GET" && webRoot && serveStatic(url.pathname, webRoot, response)) {
    return;
  }

  sendJson(response, 404, { code: "NOT_FOUND", message: "Rota não encontrada." });
};

export const createAppServer = ({
  client,
  webRoot,
  tokenVerifier,
  caseRepository,
  documentRepository,
  documentClient,
  publicationLocator,
  requestRateLimiter,
  rendererConnector,
}: {
  client: DjenClient;
  webRoot?: string;
  tokenVerifier?: TokenVerifier;
  caseRepository?: CaseRepository;
  documentRepository?: DocumentRepository;
  documentClient?: DocumentClient;
  publicationLocator?: DjenPublicationLocator;
  requestRateLimiter?: RequestRateLimiter;
  rendererConnector?: AssistedRendererConnector;
}) => {
  const privateApi: PrivateApiDependencies = {
    tokenVerifier,
    caseRepository,
    documentRepository,
    documentClient,
    publicationLocator,
    requestRateLimiter,
    rendererConnector,
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response, client, webRoot, {
      ...privateApi,
    }).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          code: "INTERNAL_ERROR",
          message: "Não foi possível processar a requisição.",
        });
      } else {
        response.destroy();
      }
    });
  });
  const websocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: MAX_BODY_BYTES,
  });

  server.on("upgrade", (request, socket, head) => {
    const reference = parseDocumentSessionPath(request.url);
    if (!reference) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (
      !privateApi.tokenVerifier ||
      !privateApi.publicationLocator ||
      !privateApi.requestRateLimiter ||
      !privateApi.rendererConnector
    ) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      const session = new AssistedDocumentSession(
        reference,
        {
          sendJson: (value) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(value));
            }
          },
          sendBinary: (value) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(value, { binary: true });
            }
          },
          close: (code, reason) => client.close(code, reason),
        },
        {
          tokenVerifier: privateApi.tokenVerifier!,
          publicationLocator: privateApi.publicationLocator!,
          requestRateLimiter: privateApi.requestRateLimiter!,
          rendererConnector: privateApi.rendererConnector!,
        },
        { schedule: scheduleSessionTimeout },
      );
      client.on("message", (data, isBinary) => {
        if (isBinary) {
          client.close(1003, "binary_control_frame");
          return;
        }
        void session.receiveText(websocketDataToText(data));
      });
      client.once("close", () => session.close());
      client.once("error", () => client.close(1011, "socket_error"));
    });
  });

  return server;
};
