import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { TokenVerifier } from "../application/authentication.js";
import {
  createRequestContext,
  type RequestContext,
} from "../application/request-context.js";
import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import { TargetValidationError } from "../domain/search-target.js";

export const MAX_BODY_BYTES = 16_384;
export const RATE_WINDOW_MS = 60_000;
export const SEARCH_RATE_LIMIT = 10;
export const DOCUMENT_RATE_LIMIT = 20;
export const DOCUMENT_MATERIALIZATION_RATE_LIMIT = 10;

const localAuthEmulatorSource = (): string => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) return "";
  const raw =
    process.env.FIREBASE_AUTH_EMULATOR_BROWSER_ORIGIN ??
    "http://127.0.0.1:9099";
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.port === ""
    ) {
      return "";
    }
    return ` ${url.origin}`;
  } catch {
    return "";
  }
};

export const applySecurityHeaders = (response: ServerResponse) => {
  const authEmulatorSource = localAuthEmulatorSource();
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

export const sendJson = (
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

export const sendPrivateJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => sendJson(response, statusCode, payload, "private, no-store");

export const authenticate = async (
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

export const createHttpRequestContext = (
  request: IncomingMessage,
  principal: AuthenticatedPrincipal,
): RequestContext => {
  const organizationId = request.headers["x-organization-id"];
  const correlationId = request.headers["x-correlation-id"];
  return createRequestContext({
    principal,
    ...(typeof organizationId === "string" && organizationId.length > 0
      ? { requestedOrganizationId: organizationId }
      : {}),
    ...(typeof correlationId === "string" && correlationId.length > 0
      ? { suppliedCorrelationId: correlationId }
      : {}),
    clock: { now: () => new Date() },
    createId: randomUUID,
  });
};

export const sendRateLimited = (
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

const safePdfFileName = (fileName: string): string => {
  const sanitized = fileName.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return sanitized.length > 0 ? sanitized : "documento.pdf";
};

export const sendPrivateDocument = (
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

export const sendPrivateJsonDocument = (
  response: ServerResponse,
  document: { readonly bytes: Uint8Array; readonly fileName: string },
) => {
  applySecurityHeaders(response);
  response.setHeader(
    "content-security-policy",
    "sandbox; default-src 'none'; frame-ancestors 'none'",
  );
  const fileName = document.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(document.bytes.byteLength),
    "content-disposition": `attachment; filename="${fileName || "exportacao.json"}"`,
    "cache-control": "private, no-store",
  });
  response.end(document.bytes);
};

export const readJsonBody = async (
  request: IncomingMessage,
): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new TargetValidationError("Requisição muito grande.");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new TargetValidationError("JSON inválido.");
  }
};
