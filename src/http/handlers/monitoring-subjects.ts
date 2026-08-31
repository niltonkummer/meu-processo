import type { MonitoredSubject } from "../../application/foundation-repository.js";
import {
  RepositoryConflictError,
  RepositoryValidationError,
} from "../../application/foundation-repository.js";
import { TargetValidationError } from "../../domain/search-target.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  RATE_WINDOW_MS,
  readJsonBody,
  sendPrivateJson,
  sendRateLimited,
} from "../transport.js";

const parseMonitoringProfileBody = (body: unknown) => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new TargetValidationError("Informe um perfil válido.");
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !["name", "cpf", "cnpj"].includes(String(record.type)) ||
    typeof record.value !== "string"
  ) {
    throw new TargetValidationError("Informe tipo e valor válidos.");
  }
  return {
    subjectType: record.type as "name" | "cpf" | "cnpj",
    value: record.value,
  };
};

const parseMonitoringProfilePage = (rawUrl: string | undefined) => {
  const parameters = new URL(rawUrl ?? "/", "http://localhost").searchParams;
  const allowed = new Set(["limit", "after", "includeInactive"]);
  if (
    [...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)
  ) {
    throw new TargetValidationError("Paginação inválida.");
  }
  const limit = Number(parameters.get("limit") ?? "20");
  const after = parameters.get("after");
  const includeInactive = parameters.get("includeInactive");
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (after !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(after)) ||
    (includeInactive !== null &&
      includeInactive !== "true" &&
      includeInactive !== "false")
  ) {
    throw new TargetValidationError("Paginação inválida.");
  }
  return {
    limit,
    ...(after ? { afterSubjectId: after } : {}),
    ...(includeInactive === "true" ? { includeInactive: true } : {}),
  };
};

const parseMonitoringProfileVersion = (header: string | string[] | undefined): number => {
  const match = typeof header === "string" ? /^"([1-9]\d*)"$/.exec(header) : null;
  const version = Number(match?.[1]);
  if (!Number.isSafeInteger(version)) {
    throw new TargetValidationError("Versão do perfil inválida.");
  }
  return version;
};

const toHttpMonitoringSubject = (subject: MonitoredSubject) => ({
  subjectId: subject.subjectId,
  subjectType: subject.subjectType,
  displayLabel: subject.displayLabel,
  status: subject.status,
  version: subject.version,
  archivedAt: subject.archivedAt,
  processCount: subject.processCount,
  processSummary: subject.processSummary.map((process) => ({
    cnjNumber: process.cnjNumber,
    tribunal: process.tribunal,
    lastActivityAt: process.lastActivityAt.toISOString(),
  })),
});

export const handleMonitoringProfiles: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  const archiveMatch = new RegExp(
    "^/api/v1/monitoring/subjects/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$",
    "i",
  ).exec(pathname);
  const isCollection =
    pathname === "/api/v1/monitoring/subjects" &&
    (request.method === "GET" || request.method === "POST");
  const isArchive = request.method === "DELETE" && Boolean(archiveMatch?.[1]);
  if (!isCollection && !isArchive) return false;

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }
  if (!dependencies.monitoringProfiles || !dependencies.requestRateLimiter) {
    sendPrivateJson(response, 503, {
      code: "MONITORING_PROFILES_UNAVAILABLE",
      message: "O cadastro de perfis ainda não está configurado.",
    });
    return true;
  }
  if (!dependencies.requestRateLimiter.allow(
    `monitoring-profiles:${principal.userId}`,
    20,
    RATE_WINDOW_MS,
  )) {
    sendRateLimited(response);
    return true;
  }

  try {
    if (isArchive) {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.search !== "") {
        throw new TargetValidationError("Parâmetros de arquivamento inválidos.");
      }
      const subject = await dependencies.monitoringProfiles.archive(
        principal.userId,
        archiveMatch![1]!,
        parseMonitoringProfileVersion(request.headers["if-match"]),
      );
      sendPrivateJson(response, 200, { subject: toHttpMonitoringSubject(subject) });
      return true;
    }
    if (request.method === "GET") {
      const result = await dependencies.monitoringProfiles.list(
        principal.userId,
        parseMonitoringProfilePage(request.url),
      );
      sendPrivateJson(response, 200, {
        items: result.items.map(toHttpMonitoringSubject),
        nextCursor: result.nextCursor,
      });
      return true;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendPrivateJson(response, 415, {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Envie o perfil como application/json.",
      });
      return true;
    }
    const command = parseMonitoringProfileBody(await readJsonBody(request));
    const subject = await dependencies.monitoringProfiles.create(
      principal.userId,
      command,
    );
    sendPrivateJson(response, 201, { subject: toHttpMonitoringSubject(subject) });
  } catch (error) {
    if (
      error instanceof TargetValidationError ||
      error instanceof RepositoryValidationError
    ) {
      sendPrivateJson(response, 400, {
        code: "INVALID_MONITORING_PROFILE",
        message: error.message,
      });
      return true;
    }
    if (error instanceof RepositoryConflictError) {
      sendPrivateJson(response, 409, {
        code: "MONITORING_PROFILE_CONFLICT",
        message: "O perfil já existe ou foi alterado.",
      });
      return true;
    }
    throw error;
  }
  return true;
};
