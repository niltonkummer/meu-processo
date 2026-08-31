import type { PrivateRequestHandler } from "../private-api.js";
import { authenticate, sendPrivateJson } from "../transport.js";

export const handlePrivateSession: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  if (request.method !== "GET" || pathname !== "/api/v1/session") return false;

  const principal = await authenticate(request, dependencies.tokenVerifier);
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
