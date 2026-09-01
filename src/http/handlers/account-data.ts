import {
  AccountDataControlsValidationError,
  AccountDataExportUnavailableError,
  AccountDataRequestNotFoundError,
  RecentAuthenticationRequiredError,
} from "../../application/account-data-controls.js";
import type { TenantDataLifecycleRequestDetails } from "../../application/tenant-data-lifecycle.js";
import { RepositoryAccessDeniedError } from "../../application/foundation-repository.js";
import { TenantDataLifecycleRequestValidationError } from "../../application/tenant-data-lifecycle.js";
import { TargetValidationError } from "../../domain/search-target.js";
import { TenantLifecycleObjectStoreError } from "../../infrastructure/local-tenant-lifecycle-object-store.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate, RATE_WINDOW_MS, readJsonBody, sendPrivateJson,
  sendPrivateJsonDocument, sendRateLimited,
} from "../transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const publicStatus = (value: TenantDataLifecycleRequestDetails) => ({
  requestId: value.requestId,
  requestType: value.requestType,
  state: value.state,
  requestedAt: value.requestedAt.toISOString(),
  completedAt: value.completedAt?.toISOString() ?? null,
  expiresAt: value.artifactExpiresAt?.toISOString() ?? null,
  sizeBytes: value.artifactSizeBytes,
  downloadReady: value.requestType === "export" && value.state === "completed" &&
    Boolean(value.artifactExpiresAt && value.artifactExpiresAt.getTime() > Date.now()),
});

export const handleAccountData: PrivateRequestHandler = async (
  request, response, pathname, dependencies,
) => {
  const match = /^\/api\/v1\/account\/data-exports\/([0-9a-f-]+)(\/download)?$/i.exec(pathname);
  const requestExport = pathname === "/api/v1/account/data-exports" && request.method === "POST";
  const requestDeletion = pathname === "/api/v1/account/deletion-requests" && request.method === "POST";
  const getStatus = request.method === "GET" && Boolean(match?.[1]) && !match?.[2];
  const download = request.method === "GET" && Boolean(match?.[1]) && match?.[2] === "/download";
  if (!requestExport && !requestDeletion && !getStatus && !download) return false;

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, { code: "UNAUTHENTICATED", message: "Autenticação necessária." });
    return true;
  }
  if (!dependencies.accountDataControls || !dependencies.requestRateLimiter) {
    sendPrivateJson(response, 503, { code: "ACCOUNT_DATA_UNAVAILABLE", message: "Os controles de dados ainda não estão configurados." });
    return true;
  }
  if (!dependencies.requestRateLimiter.allow(`account-data:${principal.userId}`, 20, RATE_WINDOW_MS)) {
    sendRateLimited(response);
    return true;
  }

  try {
    if (requestExport) {
      const result = await dependencies.accountDataControls.requestExport(principal.userId);
      sendPrivateJson(response, 202, {
        request: { requestId: result.requestId, requestType: result.requestType,
          state: result.state, requestedAt: result.requestedAt.toISOString() },
      });
      return true;
    }
    const requestId = match?.[1];
    if ((getStatus || download) && (!requestId || !UUID.test(requestId))) {
      throw new AccountDataControlsValidationError();
    }
    if (getStatus) {
      const result = await dependencies.accountDataControls.get(principal.userId, requestId!);
      sendPrivateJson(response, 200, { request: publicStatus(result) });
      return true;
    }
    if (download) {
      const document = await dependencies.accountDataControls.download(principal.userId, requestId!);
      sendPrivateJsonDocument(response, document);
      return true;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendPrivateJson(response, 415, { code: "UNSUPPORTED_MEDIA_TYPE", message: "Envie a confirmação como application/json." });
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        (body as Record<string, unknown>).confirmation !== "EXCLUIR MINHA CONTA") {
      throw new AccountDataControlsValidationError();
    }
    const result = await dependencies.accountDataControls.requestDeletion({
      providerSubject: principal.userId,
      authenticatedAt: principal.authenticatedAt,
      confirmation: "EXCLUIR MINHA CONTA",
    });
    sendPrivateJson(response, 202, {
      request: { requestId: result.requestId, requestType: result.requestType,
        state: result.state, requestedAt: result.requestedAt.toISOString() },
    });
    return true;
  } catch (error) {
    if (error instanceof RecentAuthenticationRequiredError) {
      sendPrivateJson(response, 401, { code: "REAUTHENTICATION_REQUIRED", message: "Confirme sua senha novamente antes de excluir a conta." });
      return true;
    }
    if (error instanceof AccountDataRequestNotFoundError || error instanceof RepositoryAccessDeniedError) {
      sendPrivateJson(response, 404, { code: "ACCOUNT_DATA_REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
      return true;
    }
    if (error instanceof AccountDataExportUnavailableError || error instanceof TenantLifecycleObjectStoreError) {
      sendPrivateJson(response, 409, { code: "ACCOUNT_DATA_EXPORT_UNAVAILABLE", message: "A exportação ainda não está disponível." });
      return true;
    }
    if (error instanceof AccountDataControlsValidationError ||
        error instanceof TenantDataLifecycleRequestValidationError ||
        error instanceof TargetValidationError) {
      sendPrivateJson(response, 400, { code: "INVALID_ACCOUNT_DATA_REQUEST", message: "Solicitação inválida." });
      return true;
    }
    throw error;
  }
};
