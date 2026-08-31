import type { AuthenticatedWebSession } from "./auth-client";

export type AccountDataRequestState = "pending" | "running" | "completed" | "failed" | "expired";
export interface AccountDataRequest {
  requestId: string;
  requestType: "export" | "deletion";
  state: AccountDataRequestState;
  requestedAt: string;
  completedAt?: string | null;
  expiresAt?: string | null;
  sizeBytes?: number | null;
  downloadReady?: boolean;
}

export class SafeAccountDataError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SafeAccountDataError"; }
}

const requestFrom = (body: unknown): AccountDataRequest => {
  if (typeof body !== "object" || body === null) throw new SafeAccountDataError("INVALID_RESPONSE", "A resposta recebida não é válida.");
  const value = (body as Record<string, unknown>).request;
  if (typeof value !== "object" || value === null) throw new SafeAccountDataError("INVALID_RESPONSE", "A resposta recebida não é válida.");
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== "string" || !["export", "deletion"].includes(String(record.requestType)) ||
      !["pending", "running", "completed", "failed", "expired"].includes(String(record.state)) ||
      typeof record.requestedAt !== "string") {
    throw new SafeAccountDataError("INVALID_RESPONSE", "A resposta recebida não é válida.");
  }
  return record as unknown as AccountDataRequest;
};

const authenticated = async (
  fetcher: typeof fetch, session: AuthenticatedWebSession, path: string, init: RequestInit = {},
): Promise<Response> => {
  const token = await session.getIdToken();
  return fetcher(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
};

const checked = async (response: Response): Promise<AccountDataRequest> => {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body as { code?: string; message?: string };
    throw new SafeAccountDataError(error.code ?? "REQUEST_FAILED", error.message ?? "Não foi possível concluir a solicitação.");
  }
  return requestFrom(body);
};

export const requestAccountExport = async (fetcher: typeof fetch, session: AuthenticatedWebSession) =>
  checked(await authenticated(fetcher, session, "/api/v1/account/data-exports", { method: "POST" }));

export const getAccountExport = async (fetcher: typeof fetch, session: AuthenticatedWebSession, requestId: string) =>
  checked(await authenticated(fetcher, session, `/api/v1/account/data-exports/${requestId}`));

export const downloadAccountExport = async (fetcher: typeof fetch, session: AuthenticatedWebSession, requestId: string): Promise<Blob> => {
  const response = await authenticated(fetcher, session, `/api/v1/account/data-exports/${requestId}/download`);
  if (!response.ok) {
    const body = await response.json() as { code?: string; message?: string };
    throw new SafeAccountDataError(body.code ?? "DOWNLOAD_FAILED", body.message ?? "Não foi possível baixar a exportação.");
  }
  return response.blob();
};

export const requestAccountDeletion = async (fetcher: typeof fetch, session: AuthenticatedWebSession) =>
  checked(await authenticated(fetcher, session, "/api/v1/account/deletion-requests", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "EXCLUIR MINHA CONTA" }),
  }));
