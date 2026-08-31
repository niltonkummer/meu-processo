import { describe, expect, it, vi } from "vitest";

import type { RepositoryContext } from "./foundation-repository.js";
import {
  BillingAlreadySubscribedError,
  BillingCheckoutUnavailableError,
  BillingConfigurationError,
  BillingPortalUnavailableError,
  BillingProjectionError,
  BillingValidationError,
  PersonalBilling,
  type BillingProvider,
  type BillingRepository,
} from "./personal-billing.js";

const context: RepositoryContext = {
  userId: "10000000-0000-7000-8000-000000000701",
  tenantId: "10000000-0000-7000-8000-000000000702",
};
const now = new Date("2026-08-31T15:00:00.000Z");
const requestId = "10000000-0000-7000-8000-000000000703";
const customerRef = "cus_12345678ABC";
const sessionRef = "cs_test_12345678ABC";

const subscribedState = (overrides: Record<string, unknown> = {}) => ({
  providerCustomerRef: customerRef,
  providerSubscriptionRef: "sub_12345678ABC",
  offerCode: "person" as const,
  status: "active" as const,
  currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
  ...overrides,
});

const repository = (): BillingRepository => ({
  getState: vi.fn().mockResolvedValue(null),
  bindCustomer: vi.fn().mockResolvedValue({
    outcome: "created", providerCustomerRef: customerRef,
  }),
  reserveCheckout: vi.fn().mockResolvedValue({
    outcome: "reserved", providerCustomerRef: customerRef,
    providerSessionRef: null,
    expiresAt: new Date("2026-08-31T15:30:00.000Z"),
  }),
  completeCheckout: vi.fn().mockResolvedValue({
    outcome: "created", providerSessionRef: sessionRef,
    expiresAt: new Date("2026-08-31T15:30:00.000Z"),
  }),
});

const provider = (): BillingProvider => ({
  createCustomer: vi.fn().mockResolvedValue({ providerCustomerRef: customerRef }),
  createCheckout: vi.fn().mockResolvedValue({
    providerSessionRef: sessionRef,
    providerCustomerRef: customerRef,
    url: "https://checkout.stripe.com/c/pay/test-safe",
    expiresAt: new Date("2026-08-31T15:30:00.000Z"),
  }),
  retrieveCheckout: vi.fn().mockResolvedValue({
    providerSessionRef: sessionRef,
    providerCustomerRef: customerRef,
    url: "https://checkout.stripe.com/c/pay/test-safe",
    expiresAt: new Date("2026-08-31T15:30:00.000Z"),
  }),
  createPortal: vi.fn().mockResolvedValue({
    url: "https://billing.stripe.com/p/session/test-safe",
  }),
});

const service = (
  repo = repository(),
  gateway = provider(),
) => ({
  repo,
  gateway,
  billing: new PersonalBilling(
    { resolve: vi.fn().mockResolvedValue(context) },
    repo,
    gateway,
    {
      livemode: false,
      applicationUrl: "https://validation.meu-processo.example",
      offers: new Map([["person", "price_12345678ABC"]]),
    },
    () => now,
  ),
});

describe("personal billing", () => {
  it("projects the free plan without creating a provider customer", async () => {
    const { billing, repo, gateway } = service();
    await expect(billing.getSubscription("firebase-user")).resolves.toEqual({
      plan: "free", status: "free", entitled: false,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    expect(repo.getState).toHaveBeenCalledWith(context);
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ["active", true], ["trialing", true], ["past_due", true],
    ["unpaid", false], ["canceled", false], ["paused", false],
  ] as const)("maps %s to an explicit entitlement", async (status, entitled) => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue({
      providerCustomerRef: customerRef,
      providerSubscriptionRef: "sub_12345678ABC",
      offerCode: "person",
      status,
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
    await expect(service(repo).billing.getSubscription("firebase-user"))
      .resolves.toMatchObject({ plan: "person", status, entitled });
  });

  it("creates a customer, reserves checkout and completes it idempotently", async () => {
    const { billing, repo, gateway } = service();
    await expect(billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).resolves.toEqual({
      url: "https://checkout.stripe.com/c/pay/test-safe",
      expiresAt: "2026-08-31T15:30:00.000Z",
    });
    expect(gateway.createCustomer).toHaveBeenCalledWith({
      tenantReference: context.tenantId,
      idempotencyKey: `billing-customer:${context.tenantId}`,
      livemode: false,
    });
    expect(repo.bindCustomer).toHaveBeenCalledWith(context, {
      provider: "stripe", providerCustomerRef: customerRef,
      livemode: false, createdAt: now,
    });
    expect(repo.reserveCheckout).toHaveBeenCalledWith(context, {
      requestId, offerCode: "person", requestedAt: now,
    });
    expect(gateway.createCheckout).toHaveBeenCalledWith({
      providerCustomerRef: customerRef,
      priceReference: "price_12345678ABC",
      offerCode: "person",
      tenantReference: context.tenantId,
      idempotencyKey: `billing-checkout:${context.tenantId}:${requestId}`,
      successUrl: "https://validation.meu-processo.example/?billing=success",
      cancelUrl: "https://validation.meu-processo.example/?billing=canceled",
      livemode: false,
    });
    expect(repo.completeCheckout).toHaveBeenCalledWith(context, {
      requestId, providerSessionRef: sessionRef,
      completedAt: now,
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
    });
  });

  it("retrieves an existing provider session instead of creating a second", async () => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue({
      providerCustomerRef: customerRef,
      providerSubscriptionRef: null, offerCode: null, status: null,
      currentPeriodStart: null, currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    vi.mocked(repo.reserveCheckout).mockResolvedValue({
      outcome: "created", providerCustomerRef: customerRef,
      providerSessionRef: sessionRef,
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
    });
    const { billing, gateway } = service(repo);
    await billing.createCheckout("firebase-user", { requestId, offerCode: "person" });
    expect(gateway.retrieveCheckout).toHaveBeenCalledWith({
      providerSessionRef: sessionRef, livemode: false,
    });
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it("creates a tenant-bound customer portal without exposing its reference", async () => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue({
      providerCustomerRef: customerRef,
      providerSubscriptionRef: "sub_12345678ABC", offerCode: "person",
      status: "active",
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
    const { billing, gateway } = service(repo);
    await expect(billing.createPortal("firebase-user")).resolves.toEqual({
      url: "https://billing.stripe.com/p/session/test-safe",
    });
    expect(gateway.createPortal).toHaveBeenCalledWith({
      providerCustomerRef: customerRef,
      returnUrl: "https://validation.meu-processo.example/",
      livemode: false,
    });
  });

  it("projects a customer without a subscription as free", async () => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue({
      providerCustomerRef: customerRef,
      providerSubscriptionRef: null, offerCode: null, status: null,
      currentPeriodStart: null, currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    await expect(service(repo).billing.getSubscription("firebase-user"))
      .resolves.toMatchObject({ plan: "free", status: "free", entitled: false });
  });

  it("does not grant an expired entitled status", async () => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue(subscribedState({
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    }));
    await expect(service(repo).billing.getSubscription("firebase-user"))
      .resolves.toMatchObject({ plan: "person", status: "active", entitled: false });
  });

  it("uses the production clock default when one is not injected", async () => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue(subscribedState({
      currentPeriodEnd: new Date("2099-09-01T00:00:00.000Z"),
    }));
    const billing = new PersonalBilling(
      { resolve: vi.fn().mockResolvedValue(context) }, repo, provider(),
      {
        livemode: false,
        applicationUrl: "https://validation.meu-processo.example",
        offers: new Map([["person", "price_12345678ABC"]]),
      },
    );
    await expect(billing.getSubscription("firebase-user"))
      .resolves.toMatchObject({ entitled: true });
  });

  it("rejects duplicate active subscriptions before reserving checkout", async () => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue({
      providerCustomerRef: customerRef,
      providerSubscriptionRef: "sub_12345678ABC", offerCode: "person",
      status: "active",
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
    const { billing } = service(repo);
    await expect(billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingAlreadySubscribedError);
    expect(repo.reserveCheckout).not.toHaveBeenCalled();
  });

  it.each([
    ["bad request", { requestId: "bad", offerCode: "person" }],
    ["bad offer", { requestId, offerCode: "office" }],
    ["null", null],
    ["array", []],
    ["extra property", { requestId, offerCode: "person", amount: 1 }],
    ["non-string request", { requestId: 1, offerCode: "person" }],
  ])("rejects %s before external access", async (_label, command) => {
    const { billing, repo } = service();
    await expect(billing.createCheckout("firebase-user", command))
      .rejects.toBeInstanceOf(BillingValidationError);
    expect(repo.getState).not.toHaveBeenCalled();
  });

  it.each([
    ["customer reference", { providerCustomerRef: "bad" }],
    ["subscription reference", { providerSubscriptionRef: "bad" }],
    ["offer", { offerCode: "office" }],
    ["status", { status: "unknown" }],
    ["period start type", { currentPeriodStart: null }],
    ["period start date", { currentPeriodStart: new Date(Number.NaN) }],
    ["period end type", { currentPeriodEnd: null }],
    ["period end date", { currentPeriodEnd: new Date(Number.NaN) }],
    ["period order", { currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z") }],
    ["partial absence", { providerSubscriptionRef: null }],
  ])("rejects an invalid billing state: %s", async (_label, invalid) => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue(subscribedState(invalid));
    await expect(service(repo).billing.getSubscription("firebase-user"))
      .rejects.toBeInstanceOf(BillingProjectionError);
  });

  it.each([
    ["created customer", { providerCustomerRef: "bad" }, undefined],
    ["binding outcome", { providerCustomerRef: customerRef }, { outcome: "unknown", providerCustomerRef: customerRef }],
    ["binding customer", { providerCustomerRef: customerRef }, { outcome: "existing", providerCustomerRef: "bad" }],
  ])("rejects an invalid %s projection", async (_label, created, binding) => {
    const repo = repository();
    const gateway = provider();
    vi.mocked(gateway.createCustomer).mockResolvedValue(created);
    if (binding) vi.mocked(repo.bindCustomer).mockResolvedValue(binding as never);
    await expect(service(repo, gateway).billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingProjectionError);
  });

  it.each([
    ["different customer", { providerCustomerRef: "cus_DIFFERENT1" }, BillingProjectionError],
    ["invalid expiry", { expiresAt: new Date(Number.NaN) }, BillingProjectionError],
    ["expired reservation", { outcome: "expired" }, BillingCheckoutUnavailableError],
  ])("rejects a %s reservation", async (_label, change, errorType) => {
    const repo = repository();
    vi.mocked(repo.reserveCheckout).mockResolvedValue({
      outcome: "reserved", providerCustomerRef: customerRef,
      providerSessionRef: null,
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
      ...change,
    } as never);
    await expect(service(repo).billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(errorType);
  });

  it.each([
    ["missing session", null],
    ["invalid session", "bad"],
  ])("rejects an existing Checkout with %s", async (_label, providerSessionRef) => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue({
      providerCustomerRef: customerRef,
      providerSubscriptionRef: null, offerCode: null, status: null,
      currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    vi.mocked(repo.reserveCheckout).mockResolvedValue({
      outcome: "created", providerCustomerRef: customerRef, providerSessionRef,
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
    });
    await expect(service(repo).billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingProjectionError);
  });

  it.each([
    ["session", { providerSessionRef: "bad" }],
    ["date", { expiresAt: new Date(Number.NaN) }],
    ["customer", { providerCustomerRef: "cus_DIFFERENT1" }],
    ["expired", { expiresAt: now }],
    ["too long", { expiresAt: new Date(now.getTime() + 86_400_001) }],
  ])("rejects Checkout with invalid %s", async (_label, change) => {
    const gateway = provider();
    vi.mocked(gateway.createCheckout).mockResolvedValue({
      providerSessionRef: sessionRef, providerCustomerRef: customerRef,
      url: "https://checkout.stripe.com/c/pay/test-safe",
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
      ...change,
    });
    await expect(service(repository(), gateway).billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingProjectionError);
  });

  it.each([
    ["session", { providerSessionRef: "cs_test_DIFFERENT1" }],
    ["date", { expiresAt: new Date(Number.NaN) }],
  ])("rejects a mismatched Checkout completion %s", async (_label, change) => {
    const repo = repository();
    vi.mocked(repo.completeCheckout).mockResolvedValue({
      outcome: "created", providerSessionRef: sessionRef,
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
      ...change,
    });
    await expect(service(repo).billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingProjectionError);
  });

  it("rejects an unavailable customer portal", async () => {
    await expect(service().billing.createPortal("firebase-user"))
      .rejects.toBeInstanceOf(BillingPortalUnavailableError);
  });

  it.each([
    "http://billing.stripe.com/p/session/x",
    "https://evil.example/p/session/x",
    "not-a-url",
  ])("rejects an unsafe portal URL %s", async (url) => {
    const repo = repository();
    vi.mocked(repo.getState).mockResolvedValue(subscribedState());
    const gateway = provider();
    vi.mocked(gateway.createPortal).mockResolvedValue({ url });
    await expect(service(repo, gateway).billing.createPortal("firebase-user"))
      .rejects.toBeInstanceOf(BillingProjectionError);
  });

  it("rejects an invalid injected clock", async () => {
    const invalidClock = new PersonalBilling(
      { resolve: vi.fn().mockResolvedValue(context) }, repository(), provider(),
      {
        livemode: false, applicationUrl: "http://127.0.0.1:18080",
        offers: new Map([["person", "price_12345678ABC"]]),
      },
      () => new Date(Number.NaN),
    );
    await expect(invalidClock.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingProjectionError);
  });

  it.each([
    "http://checkout.stripe.com/c/pay/x",
    "https://evil.example/c/pay/x",
    "https://checkout.stripe.com@evil.example/x",
  ])("rejects an unsafe provider URL %s", async (url) => {
    const gateway = provider();
    vi.mocked(gateway.createCheckout).mockResolvedValue({
      providerSessionRef: sessionRef, providerCustomerRef: customerRef, url,
      expiresAt: new Date("2026-08-31T15:30:00.000Z"),
    });
    await expect(service(repository(), gateway).billing.createCheckout(
      "firebase-user", { requestId, offerCode: "person" },
    )).rejects.toBeInstanceOf(BillingProjectionError);
  });

  it.each([
    { livemode: true, applicationUrl: "https://validation.example", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "http://validation.example", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "https://validation.example/path", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "https://user@validation.example", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "https://validation.example?x=1", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "https://validation.example#x", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "not-a-url", offers: new Map([["person", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "https://validation.example", offers: new Map() },
    { livemode: false, applicationUrl: "https://validation.example", offers: new Map([["office", "price_12345678ABC"]]) },
    { livemode: false, applicationUrl: "https://validation.example", offers: new Map([["person", "bad"]]) },
  ])("fails closed for invalid validation configuration %#", (config) => {
    expect(() => new PersonalBilling(
      { resolve: vi.fn() }, repository(), provider(), config,
    )).toThrow(BillingConfigurationError);
  });
});
