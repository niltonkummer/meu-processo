import {
  BillingAlreadySubscribedError,
  BillingCheckoutUnavailableError,
  BillingPortalUnavailableError,
  BillingProjectionError,
  BillingValidationError,
} from "../../application/personal-billing.js";
import { RepositoryAccessDeniedError } from "../../application/foundation-repository.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  readJsonBody,
  sendPrivateJson,
} from "../transport.js";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKOUT_LIMIT = 5;
const CHECKOUT_WINDOW_MS = 86_400_000;
const PORTAL_LIMIT = 20;
const PORTAL_WINDOW_MS = 3_600_000;

const unavailable = (response: Parameters<PrivateRequestHandler>[1]) => {
  sendPrivateJson(response, 503, {
    code: "BILLING_UNAVAILABLE",
    message: "A gestão da assinatura não está disponível.",
  });
};

const handleError = (
  response: Parameters<PrivateRequestHandler>[1],
  error: unknown,
) => {
  if (error instanceof BillingValidationError) {
    sendPrivateJson(response, 400, { code: "BILLING_INVALID", message: error.message });
  } else if (error instanceof RepositoryAccessDeniedError) {
    sendPrivateJson(response, 403, { code: "FORBIDDEN", message: "Acesso negado." });
  } else if (error instanceof BillingAlreadySubscribedError) {
    sendPrivateJson(response, 409, { code: "ALREADY_SUBSCRIBED", message: error.message });
  } else if (
    error instanceof BillingCheckoutUnavailableError ||
    error instanceof BillingPortalUnavailableError
  ) {
    sendPrivateJson(response, 409, { code: "BILLING_SESSION_UNAVAILABLE", message: error.message });
  } else {
    sendPrivateJson(response, error instanceof BillingProjectionError ? 502 : 503, {
      code: "BILLING_UNAVAILABLE",
      message: "Não foi possível processar a assinatura.",
    });
  }
};

export const handlePrivateBilling: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  const subscription = request.method === "GET" && pathname === "/api/v1/billing/subscription";
  const checkout = request.method === "POST" && pathname === "/api/v1/billing/checkout-sessions";
  const portal = request.method === "POST" && pathname === "/api/v1/billing/portal-sessions";
  if (!subscription && !checkout && !portal) return false;

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }
  if (!dependencies.billing) {
    unavailable(response);
    return true;
  }

  try {
    if (subscription) {
      sendPrivateJson(response, 200, await dependencies.billing.getSubscription(principal.userId));
      return true;
    }
    if (!dependencies.requestRateLimiter) {
      unavailable(response);
      return true;
    }
    const limit = checkout ? CHECKOUT_LIMIT : PORTAL_LIMIT;
    const windowMs = checkout ? CHECKOUT_WINDOW_MS : PORTAL_WINDOW_MS;
    const action = checkout ? "checkout" : "portal";
    if (!dependencies.requestRateLimiter.allow(
      `billing:${action}:${principal.userId}`, limit, windowMs,
    )) {
      sendPrivateJson(response, 429, {
        code: "BILLING_RATE_LIMITED",
        message: "Limite temporário atingido. Tente novamente mais tarde.",
      });
      return true;
    }
    if (checkout) {
      if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        sendPrivateJson(response, 415, {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Envie o corpo como application/json.",
        });
        return true;
      }
      const requestId = request.headers["idempotency-key"];
      if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
        sendPrivateJson(response, 400, {
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "Identificador idempotente inválido.",
        });
        return true;
      }
      const body = await readJsonBody(request);
      if (
        typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        (body as Record<string, unknown>).offerCode !== "person"
      ) throw new BillingValidationError();
      sendPrivateJson(response, 201, await dependencies.billing.createCheckout(
        principal.userId,
        { requestId, offerCode: "person" },
      ));
      return true;
    }
    sendPrivateJson(response, 201, await dependencies.billing.createPortal(principal.userId));
  } catch (error) {
    handleError(response, error);
  }
  return true;
};
