import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BillingWebhook,
  BillingWebhookVerificationError,
  type BillingEventRepository,
  type BillingWebhookVerifier,
} from "../application/billing-webhook.js";
import {
  BillingAlreadySubscribedError,
  type PersonalBillingService,
} from "../application/personal-billing.js";
import type { DjenClient } from "../application/types.js";
import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import { createAppServer } from "./server.js";

const servers: ReturnType<typeof createAppServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>(
    (resolve, reject) => server.close((error) => error ? reject(error) : resolve()),
  )));
});

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [{ organizationId: "org_alpha", role: "lawyer", active: true }],
};
const client: DjenClient = { search: vi.fn() };
const billing = (): PersonalBillingService => ({
  getSubscription: vi.fn().mockResolvedValue({
    plan: "free", status: "free", entitled: false,
    currentPeriodEnd: null, cancelAtPeriodEnd: false,
  }),
  createCheckout: vi.fn().mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/test-safe",
    expiresAt: "2026-08-31T15:30:00.000Z",
  }),
  createPortal: vi.fn().mockResolvedValue({
    url: "https://billing.stripe.com/p/session/test-safe",
  }),
});
const start = async (options: Parameters<typeof createAppServer>[0]) => {
  const server = createAppServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const authenticated = (service = billing()) => ({
  client,
  billing: service,
  tokenVerifier: { verify: vi.fn().mockResolvedValue(principal) },
  requestRateLimiter: { allow: vi.fn().mockReturnValue(true) },
});

describe("billing HTTP boundary", () => {
  it("requires authentication and hides whether billing is configured", async () => {
    const origin = await start({ client });
    const response = await fetch(`${origin}/api/v1/billing/subscription`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns the minimized authenticated subscription projection", async () => {
    const service = billing();
    const origin = await start(authenticated(service));
    const response = await fetch(`${origin}/api/v1/billing/subscription`, {
      headers: { authorization: "Bearer safe-token" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plan: "free", status: "free", entitled: false,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    expect(service.getSubscription).toHaveBeenCalledWith("user_alpha");
  });

  it("creates an idempotent hosted Checkout from a server-owned offer", async () => {
    const service = billing();
    const options = authenticated(service);
    const origin = await start(options);
    const requestId = "10000000-0000-7000-8000-000000000703";
    const response = await fetch(`${origin}/api/v1/billing/checkout-sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer safe-token",
        "content-type": "application/json",
        "idempotency-key": requestId,
      },
      body: JSON.stringify({ offerCode: "person" }),
    });
    expect(response.status).toBe(201);
    expect(service.createCheckout).toHaveBeenCalledWith(
      "user_alpha", { requestId, offerCode: "person" },
    );
    expect(options.requestRateLimiter.allow).toHaveBeenCalledWith(
      "billing:checkout:user_alpha", 5, 86_400_000,
    );
  });

  it.each([
    ["media type", { headers: { "idempotency-key": "10000000-0000-7000-8000-000000000703" }, body: "{}" }, 415],
    ["idempotency", { headers: { "content-type": "application/json", "idempotency-key": "bad" }, body: "{}" }, 400],
    ["offer", { headers: { "content-type": "application/json", "idempotency-key": "10000000-0000-7000-8000-000000000703" }, body: JSON.stringify({ offerCode: "office" }) }, 400],
  ])("rejects an invalid Checkout %s", async (_label, input, status) => {
    const origin = await start(authenticated());
    const response = await fetch(`${origin}/api/v1/billing/checkout-sessions`, {
      method: "POST",
      headers: { authorization: "Bearer safe-token", ...input.headers },
      body: input.body,
    });
    expect(response.status).toBe(status);
  });

  it("rate limits provider session creation", async () => {
    const options = authenticated();
    options.requestRateLimiter.allow.mockReturnValue(false);
    const origin = await start(options);
    const response = await fetch(`${origin}/api/v1/billing/portal-sessions`, {
      method: "POST", headers: { authorization: "Bearer safe-token" },
    });
    expect(response.status).toBe(429);
    expect(options.billing.createPortal).not.toHaveBeenCalled();
  });

  it("maps subscription conflicts without leaking provider references", async () => {
    const service = billing();
    vi.mocked(service.createCheckout).mockRejectedValue(new BillingAlreadySubscribedError());
    const origin = await start(authenticated(service));
    const response = await fetch(`${origin}/api/v1/billing/checkout-sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer safe-token", "content-type": "application/json",
        "idempotency-key": "10000000-0000-7000-8000-000000000703",
      },
      body: JSON.stringify({ offerCode: "person" }),
    });
    expect(response.status).toBe(409);
    await expect(response.text()).resolves.not.toContain("cus_");
  });

  it("preserves and acknowledges a signed raw webhook", async () => {
    const rawEvent = Buffer.from('{"id":"evt_safe"}');
    const verifier: BillingWebhookVerifier = { verify: vi.fn().mockResolvedValue({
      providerEventRef: "evt_12345678ABC",
      eventType: "customer.subscription.updated",
      livemode: false,
      payloadHash: Buffer.alloc(32, 1),
      providerCustomerRef: "cus_12345678ABC",
      providerSubscriptionRef: "sub_12345678ABC",
      offerCode: "person",
      subscriptionStatus: "active",
      currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      providerCreatedAt: new Date("2026-08-31T15:00:00Z"),
    }) };
    const repository: BillingEventRepository = { apply: vi.fn().mockResolvedValue({
      outcome: "applied", tenantId: "10000000-0000-7000-8000-000000000702",
    }) };
    const origin = await start({
      client, billingWebhook: new BillingWebhook(verifier, repository),
    });
    const response = await fetch(`${origin}/api/v1/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=safe" },
      body: rawEvent,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "applied" });
    expect(verifier.verify).toHaveBeenCalledWith(rawEvent, "t=1,v1=safe");
  });

  it("rejects a webhook with an invalid signature and requests retry on persistence failure", async () => {
    const verifier: BillingWebhookVerifier = {
      verify: vi.fn().mockRejectedValue(new BillingWebhookVerificationError()),
    };
    const repository: BillingEventRepository = { apply: vi.fn() };
    const origin = await start({
      client, billingWebhook: new BillingWebhook(verifier, repository),
    });
    const invalid = await fetch(`${origin}/api/v1/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "invalid" },
      body: "{}",
    });
    expect(invalid.status).toBe(400);

    vi.mocked(verifier.verify).mockRejectedValue(new Error("database unavailable"));
    const retry = await fetch(`${origin}/api/v1/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "valid" },
      body: "{}",
    });
    expect(retry.status).toBe(503);
  });
});
