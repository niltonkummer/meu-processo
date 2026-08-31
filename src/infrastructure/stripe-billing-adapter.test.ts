import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  StripeBillingAdapter,
  StripeBillingConfigurationError,
  StripeBillingProjectionError,
  StripeWebhookVerificationError,
} from "./stripe-billing-adapter.js";

const secretKey = "sk_test_1234567890abcdefghijklmnop";
const webhookSecret = "whsec_1234567890abcdefghijklmnop";
const priceRef = "price_12345678ABC";
const customerRef = "cus_12345678ABC";
const sessionRef = "cs_test_12345678ABC";
const tenantRef = "10000000-0000-7000-8000-000000000702";
const client = () => new Stripe(secretKey, {
  apiVersion: "2026-02-25.clover",
  telemetry: false,
});
const adapter = (stripe = client()) => ({
  stripe,
  adapter: new StripeBillingAdapter({
    secretKey,
    webhookSecret,
    offers: new Map([["person", priceRef]]),
  }, stripe),
});

describe("Stripe billing adapter", () => {
  it("creates a customer without PII and with an idempotency key", async () => {
    const { stripe, adapter: gateway } = adapter();
    const create = vi.spyOn(stripe.customers, "create").mockResolvedValue({
      id: customerRef, object: "customer",
    } as Stripe.Response<Stripe.Customer>);
    await expect(gateway.createCustomer({
      tenantReference: tenantRef,
      idempotencyKey: `billing-customer:${tenantRef}`,
      livemode: false,
    })).resolves.toEqual({ providerCustomerRef: customerRef });
    expect(create).toHaveBeenCalledWith({
      metadata: { tenant_reference: tenantRef },
    }, { idempotencyKey: `billing-customer:${tenantRef}` });
  });

  it("creates a hosted subscription Checkout with server-owned values", async () => {
    const { stripe, adapter: gateway } = adapter();
    const create = vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({
      id: sessionRef,
      object: "checkout.session",
      customer: customerRef,
      mode: "subscription",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/test-safe",
      expires_at: 1_788_191_400,
    } as Stripe.Response<Stripe.Checkout.Session>);
    await expect(gateway.createCheckout({
      providerCustomerRef: customerRef,
      priceReference: priceRef,
      offerCode: "person",
      tenantReference: tenantRef,
      idempotencyKey: `billing-checkout:${tenantRef}:request`,
      successUrl: "https://validation.example/?billing=success",
      cancelUrl: "https://validation.example/?billing=canceled",
      livemode: false,
    })).resolves.toEqual({
      providerSessionRef: sessionRef,
      providerCustomerRef: customerRef,
      url: "https://checkout.stripe.com/c/pay/test-safe",
      expiresAt: new Date(1_788_191_400_000),
    });
    expect(create).toHaveBeenCalledWith({
      mode: "subscription",
      customer: customerRef,
      client_reference_id: tenantRef,
      line_items: [{ price: priceRef, quantity: 1 }],
      success_url: "https://validation.example/?billing=success",
      cancel_url: "https://validation.example/?billing=canceled",
      metadata: { offer_code: "person", tenant_reference: tenantRef },
      subscription_data: {
        metadata: { offer_code: "person", tenant_reference: tenantRef },
      },
    }, { idempotencyKey: `billing-checkout:${tenantRef}:request` });
  });

  it("retrieves only an open subscription Checkout from test mode", async () => {
    const { stripe, adapter: gateway } = adapter();
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue({
      id: sessionRef, object: "checkout.session", customer: customerRef,
      mode: "subscription", status: "open",
      url: "https://checkout.stripe.com/c/pay/test-safe",
      expires_at: 1_788_191_400,
    } as Stripe.Response<Stripe.Checkout.Session>);
    await expect(gateway.retrieveCheckout({
      providerSessionRef: sessionRef, livemode: false,
    })).resolves.toMatchObject({
      providerSessionRef: sessionRef,
      providerCustomerRef: customerRef,
    });
  });

  it("creates a customer-bound portal session", async () => {
    const { stripe, adapter: gateway } = adapter();
    const create = vi.spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue({
        id: "bps_12345678ABC", object: "billing_portal.session",
        customer: customerRef, livemode: false,
        return_url: "https://validation.example/",
        url: "https://billing.stripe.com/p/session/test-safe",
        created: 1_788_189_600,
      } as Stripe.Response<Stripe.BillingPortal.Session>);
    await expect(gateway.createPortal({
      providerCustomerRef: customerRef,
      returnUrl: "https://validation.example/",
      livemode: false,
    })).resolves.toEqual({
      url: "https://billing.stripe.com/p/session/test-safe",
    });
    expect(create).toHaveBeenCalledWith({
      customer: customerRef,
      return_url: "https://validation.example/",
    });
  });

  it("verifies and minimizes a subscription webhook", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_788_189_601_000));
    const { stripe, adapter: gateway } = adapter();
    const payload = JSON.stringify({
      id: "evt_12345678ABC",
      object: "event",
      api_version: "2026-02-25.clover",
      created: 1_788_189_600,
      data: { object: {
        id: "sub_12345678ABC",
        object: "subscription",
        customer: customerRef,
        livemode: false,
        status: "active",
        cancel_at_period_end: false,
        items: { object: "list", data: [{
          id: "si_12345678ABC", object: "subscription_item",
          current_period_start: 1_785_513_600,
          current_period_end: 1_788_192_000,
          price: { id: priceRef, object: "price" },
        }] },
      } },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: "customer.subscription.updated",
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload, secret: webhookSecret, timestamp: 1_788_189_601,
    });
    try {
      await expect(gateway.verify(Buffer.from(payload), signature)).resolves.toEqual({
        providerEventRef: "evt_12345678ABC",
        eventType: "customer.subscription.updated",
        livemode: false,
        payloadHash: expect.any(Buffer),
        providerCustomerRef: customerRef,
        providerSubscriptionRef: "sub_12345678ABC",
        offerCode: "person",
        subscriptionStatus: "active",
        currentPeriodStart: new Date(1_785_513_600_000),
        currentPeriodEnd: new Date(1_788_192_000_000),
        cancelAtPeriodEnd: false,
        providerCreatedAt: new Date(1_788_189_600_000),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid webhook signature without parsing provider data", async () => {
    await expect(adapter().adapter.verify(
      Buffer.from("{}"), "t=1,v1=invalid",
    )).rejects.toBeInstanceOf(StripeWebhookVerificationError);
  });

  it.each([
    { secretKey: "sk_live_invalid", webhookSecret, offers: new Map([["person", priceRef]]) },
    { secretKey, webhookSecret: "bad", offers: new Map([["person", priceRef]]) },
    { secretKey, webhookSecret, offers: new Map([["person", "bad"]]) },
  ])("rejects unsafe test-mode configuration %#", (config) => {
    expect(() => new StripeBillingAdapter(config as never, client()))
      .toThrow(StripeBillingConfigurationError);
  });

  it("rejects inconsistent Checkout responses", async () => {
    const { stripe, adapter: gateway } = adapter();
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue({
      id: sessionRef, object: "checkout.session", customer: customerRef,
      mode: "payment", status: "complete", url: null,
      expires_at: 1_788_191_400,
    } as Stripe.Response<Stripe.Checkout.Session>);
    await expect(gateway.retrieveCheckout({
      providerSessionRef: sessionRef, livemode: false,
    })).rejects.toBeInstanceOf(StripeBillingProjectionError);
  });
});
