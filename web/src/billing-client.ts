import type { AuthenticatedWebSession } from "./auth-client";

export type BillingStatus =
  | "free" | "incomplete" | "incomplete_expired" | "trialing" | "active"
  | "past_due" | "canceled" | "unpaid" | "paused";
export interface BillingSubscription {
  plan: "free" | "person";
  status: BillingStatus;
  entitled: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export class SafeBillingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message); this.name = "SafeBillingError";
  }
}

const errorFrom = (body: unknown) => {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown> : {};
  return new SafeBillingError(
    typeof value.code === "string" ? value.code : "BILLING_FAILED",
    typeof value.message === "string"
      ? value.message : "Não foi possível acessar a assinatura.",
  );
};

const authorized = async (
  fetcher: typeof fetch,
  session: AuthenticatedWebSession,
  path: string,
  init: RequestInit = {},
) => fetcher(path, {
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${await session.getIdToken()}` },
});

const json = async (response: Response): Promise<unknown> => {
  try { return await response.json() as unknown; }
  catch { throw new SafeBillingError("INVALID_RESPONSE", "A resposta recebida não é válida."); }
};

export const getBillingSubscription = async (
  fetcher: typeof fetch,
  session: AuthenticatedWebSession,
): Promise<BillingSubscription> => {
  const response = await authorized(fetcher, session, "/api/v1/billing/subscription");
  const body = await json(response);
  if (!response.ok) throw errorFrom(body);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw errorFrom(null);
  const value = body as Record<string, unknown>;
  const statuses = [
    "free", "incomplete", "incomplete_expired", "trialing", "active",
    "past_due", "canceled", "unpaid", "paused",
  ];
  if (
    !["free", "person"].includes(String(value.plan)) ||
    !statuses.includes(String(value.status)) || typeof value.entitled !== "boolean" ||
    !(value.currentPeriodEnd === null || typeof value.currentPeriodEnd === "string") ||
    typeof value.cancelAtPeriodEnd !== "boolean"
  ) throw errorFrom(null);
  return value as unknown as BillingSubscription;
};

const hostedSession = async (response: Response, expectedHost: string) => {
  const body = await json(response);
  if (!response.ok) throw errorFrom(body);
  const url = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).url : undefined;
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost) throw new Error();
    return parsed.toString();
  } catch {
    throw new SafeBillingError("INVALID_RESPONSE", "A sessão de pagamento recebida não é válida.");
  }
};

export const createBillingCheckout = async (
  fetcher: typeof fetch,
  session: AuthenticatedWebSession,
  requestId: string,
) => hostedSession(await authorized(fetcher, session, "/api/v1/billing/checkout-sessions", {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": requestId },
  body: JSON.stringify({ offerCode: "person" }),
}), "checkout.stripe.com");

export const createBillingPortal = async (
  fetcher: typeof fetch,
  session: AuthenticatedWebSession,
) => hostedSession(await authorized(fetcher, session, "/api/v1/billing/portal-sessions", {
  method: "POST",
}), "billing.stripe.com");
