import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedWebSession } from "./auth-client";
import {
  createBillingCheckout,
  createBillingPortal,
  getBillingSubscription,
  SafeBillingError,
} from "./billing-client";

const session: AuthenticatedWebSession = {
  email: "person@example.test",
  getIdToken: vi.fn().mockResolvedValue("private-token"),
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const subscription = {
  plan: "free", status: "free", entitled: false,
  currentPeriodEnd: null, cancelAtPeriodEnd: false,
};

describe("billing client", () => {
  it("reads the minimized subscription with same-origin authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(subscription));
    await expect(getBillingSubscription(fetcher, session)).resolves.toEqual(subscription);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/billing/subscription", {
      headers: { authorization: "Bearer private-token" },
    });
  });

  it("creates fixed hosted Checkout and portal sessions", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ url: "https://checkout.stripe.com/c/pay/test-safe" }, 201))
      .mockResolvedValueOnce(json({ url: "https://billing.stripe.com/p/session/test-safe" }, 201));
    await expect(createBillingCheckout(fetcher, session, "request-id"))
      .resolves.toBe("https://checkout.stripe.com/c/pay/test-safe");
    await expect(createBillingPortal(fetcher, session))
      .resolves.toBe("https://billing.stripe.com/p/session/test-safe");
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/billing/checkout-sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer private-token",
        "content-type": "application/json",
        "idempotency-key": "request-id",
      },
      body: JSON.stringify({ offerCode: "person" }),
    });
  });

  it.each([
    [null],
    [[]],
    [{ ...subscription, plan: "office" }],
    [{ ...subscription, status: "unknown" }],
    [{ ...subscription, entitled: "yes" }],
    [{ ...subscription, currentPeriodEnd: 1 }],
    [{ ...subscription, cancelAtPeriodEnd: "no" }],
  ])("rejects malformed subscription response %#", async (body) => {
    await expect(getBillingSubscription(
      vi.fn<typeof fetch>().mockResolvedValue(json(body)), session,
    )).rejects.toBeInstanceOf(SafeBillingError);
  });

  it.each([
    ["http://checkout.stripe.com/c/pay/test"],
    ["https://evil.example/c/pay/test"],
    ["not-a-url"],
    [undefined],
  ])("rejects an unsafe hosted URL %#", async (url) => {
    await expect(createBillingCheckout(
      vi.fn<typeof fetch>().mockResolvedValue(json({ url }, 201)), session, "request-id",
    )).rejects.toBeInstanceOf(SafeBillingError);
  });

  it("maps safe API failures and invalid JSON", async () => {
    await expect(getBillingSubscription(
      vi.fn<typeof fetch>().mockResolvedValue(json({ code: "DENIED", message: "Negado." }, 403)), session,
    )).rejects.toEqual(new SafeBillingError("DENIED", "Negado."));
    await expect(getBillingSubscription(
      vi.fn<typeof fetch>().mockResolvedValue(json({}, 500)), session,
    )).rejects.toEqual(new SafeBillingError("BILLING_FAILED", "Não foi possível acessar a assinatura."));
    await expect(getBillingSubscription(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 })), session,
    )).rejects.toEqual(new SafeBillingError("INVALID_RESPONSE", "A resposta recebida não é válida."));
    await expect(createBillingPortal(
      vi.fn<typeof fetch>().mockResolvedValue(json({ code: "PORTAL_DENIED", message: "Portal negado." }, 403)),
      session,
    )).rejects.toEqual(new SafeBillingError("PORTAL_DENIED", "Portal negado."));
  });

  it.each([null, "invalid"])('rejects a non-object hosted session response %#', async (body) => {
    await expect(createBillingPortal(
      vi.fn<typeof fetch>().mockResolvedValue(json(body, 201)), session,
    )).rejects.toBeInstanceOf(SafeBillingError);
  });
});
