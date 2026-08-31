import { searchProcesses } from "../../application/search-processes.js";
import { TargetValidationError } from "../../domain/search-target.js";
import { DjenRateLimitError } from "../../infrastructure/djen-client.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  RATE_WINDOW_MS,
  readJsonBody,
  SEARCH_RATE_LIMIT,
  sendPrivateJson,
  sendRateLimited,
} from "../transport.js";

export const handleAuthenticatedSearch: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
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
    const result = await searchProcesses(input, dependencies.client);
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
