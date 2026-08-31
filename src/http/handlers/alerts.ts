import {
  AlertNotFoundError,
  AlertPageValidationError,
} from "../../application/internal-alerts.js";
import { RepositoryAccessDeniedError } from "../../application/foundation-repository.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  RATE_WINDOW_MS,
  sendPrivateJson,
  sendRateLimited,
} from "../transport.js";

const parseAlertPage = (rawUrl: string | undefined) => {
  const parameters = new URL(rawUrl ?? "/", "http://localhost").searchParams;
  const allowed = new Set(["limit", "status", "cursor"]);
  if (
    [...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)
  ) throw new AlertPageValidationError();
  const limit = Number(parameters.get("limit") ?? "20");
  const status = parameters.get("status") ?? "all";
  const cursor = parameters.get("cursor");
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !["all", "unread", "read"].includes(status) ||
    (cursor !== null && !/^[A-Za-z0-9_-]{8,512}$/.test(cursor))
  ) throw new AlertPageValidationError();
  return {
    limit,
    status: status as "all" | "unread" | "read",
    ...(cursor ? { cursor } : {}),
  };
};

export const handlePrivateAlerts: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  const readMatch = /^\/api\/v1\/alerts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/read$/i.exec(pathname);
  const isList = request.method === "GET" && pathname === "/api/v1/alerts";
  const isRead = request.method === "PATCH" && Boolean(readMatch?.[1]);
  if (!isList && !isRead) return false;
  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }
  if (!dependencies.alerts || !dependencies.requestRateLimiter) {
    sendPrivateJson(response, 503, {
      code: "ALERTS_UNAVAILABLE",
      message: "Os alertas ainda não estão configurados.",
    });
    return true;
  }
  if (!dependencies.requestRateLimiter.allow(
    `alerts:${principal.userId}`,
    30,
    RATE_WINDOW_MS,
  )) {
    sendRateLimited(response);
    return true;
  }
  try {
    if (isList) {
      const result = await dependencies.alerts.list(
        principal.userId,
        parseAlertPage(request.url),
      );
      sendPrivateJson(response, 200, result);
      return true;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.search !== "") throw new AlertPageValidationError();
    const alert = await dependencies.alerts.markRead(
      principal.userId,
      readMatch![1]!,
    );
    sendPrivateJson(response, 200, { alert });
    return true;
  } catch (error) {
    if (error instanceof AlertPageValidationError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_ALERT_REQUEST",
        message: error.message,
      });
      return true;
    }
    if (error instanceof AlertNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "ALERT_NOT_FOUND",
        message: error.message,
      });
      return true;
    }
    if (error instanceof RepositoryAccessDeniedError) {
      sendPrivateJson(response, 403, {
        code: "FORBIDDEN",
        message: "Acesso negado.",
      });
      return true;
    }
    throw error;
  }
};
