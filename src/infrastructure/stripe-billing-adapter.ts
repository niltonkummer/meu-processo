import { createHash } from "node:crypto";

import Stripe from "stripe";

import type {
  BillingProvider,
  BillingSubscriptionStatus,
} from "../application/personal-billing.js";
import type {
  BillingEventType,
  BillingWebhookVerifier,
  CanonicalBillingSubscriptionEvent,
} from "../application/billing-webhook.js";
import { BillingWebhookVerificationError } from "../application/billing-webhook.js";

export class StripeBillingConfigurationError extends Error {
  constructor() { super("Stripe billing configuration is invalid."); this.name = "StripeBillingConfigurationError"; }
}
export class StripeBillingProjectionError extends Error {
  constructor() { super("Stripe billing response is invalid."); this.name = "StripeBillingProjectionError"; }
}
export class StripeWebhookVerificationError extends BillingWebhookVerificationError {
  constructor() { super(); this.name = "StripeWebhookVerificationError"; }
}

interface StripeBillingConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly offers: ReadonlyMap<string, string>;
}

const CUSTOMER = /^cus_[A-Za-z0-9]{8,255}$/;
const SESSION = /^cs_test_[A-Za-z0-9]{8,255}$/;
const PRICE = /^price_[A-Za-z0-9]{8,255}$/;
const EVENT = /^evt_[A-Za-z0-9]{8,255}$/;
const SUBSCRIPTION = /^sub_[A-Za-z0-9]{8,255}$/;
const SECRET = /^sk_test_[A-Za-z0-9]{24,255}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]{24,255}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY = /^[A-Za-z0-9:_-]{16,255}$/;
const EVENT_TYPES = new Set<BillingEventType>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const STATUSES = new Set<BillingSubscriptionStatus>([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due",
  "canceled", "unpaid", "paused",
]);

const objectRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StripeBillingProjectionError();
  }
  return value as Record<string, unknown>;
};

const safeUrl = (value: unknown, host: string): string => {
  if (typeof value !== "string") throw new StripeBillingProjectionError();
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.hostname !== host || url.port ||
      url.username || url.password || url.hash
    ) throw new StripeBillingProjectionError();
    return url.toString();
  } catch (error) {
    if (error instanceof StripeBillingProjectionError) throw error;
    throw new StripeBillingProjectionError();
  }
};

const customerReference = (value: unknown): string => {
  if (typeof value !== "string" || !CUSTOMER.test(value)) {
    throw new StripeBillingProjectionError();
  }
  return value;
};

export class StripeBillingAdapter implements BillingProvider, BillingWebhookVerifier {
  private readonly offers: ReadonlyMap<string, string>;

  constructor(
    config: StripeBillingConfig,
    private readonly stripe: Stripe = new Stripe(config.secretKey, {
      apiVersion: "2026-02-25.clover",
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
      typescript: true,
    }),
  ) {
    if (
      !SECRET.test(config.secretKey) || !WEBHOOK_SECRET.test(config.webhookSecret) ||
      config.offers.size !== 1 || !PRICE.test(config.offers.get("person") ?? "")
    ) throw new StripeBillingConfigurationError();
    this.webhookSecret = config.webhookSecret;
    this.offers = config.offers;
  }

  private readonly webhookSecret: string;

  async createCustomer(input: {
    tenantReference: string;
    idempotencyKey: string;
    livemode: boolean;
  }): Promise<{ providerCustomerRef: string }> {
    this.validateTestCommand(input.tenantReference, input.idempotencyKey, input.livemode);
    const customer = await this.stripe.customers.create({
      metadata: { tenant_reference: input.tenantReference },
    }, { idempotencyKey: input.idempotencyKey });
    return { providerCustomerRef: customerReference(customer.id) };
  }

  async createCheckout(input: {
    providerCustomerRef: string;
    priceReference: string;
    offerCode: "person";
    tenantReference: string;
    idempotencyKey: string;
    successUrl: string;
    cancelUrl: string;
    livemode: boolean;
  }) {
    this.validateTestCommand(input.tenantReference, input.idempotencyKey, input.livemode);
    if (
      !CUSTOMER.test(input.providerCustomerRef) || input.offerCode !== "person" ||
      this.offers.get(input.offerCode) !== input.priceReference ||
      !PRICE.test(input.priceReference)
    ) throw new StripeBillingProjectionError();
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.providerCustomerRef,
      client_reference_id: input.tenantReference,
      line_items: [{ price: input.priceReference, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        offer_code: input.offerCode,
        tenant_reference: input.tenantReference,
      },
      subscription_data: { metadata: {
        offer_code: input.offerCode,
        tenant_reference: input.tenantReference,
      } },
    }, { idempotencyKey: input.idempotencyKey });
    return this.checkoutProjection(session);
  }

  async retrieveCheckout(input: {
    providerSessionRef: string;
    livemode: boolean;
  }) {
    if (input.livemode || !SESSION.test(input.providerSessionRef)) {
      throw new StripeBillingProjectionError();
    }
    return this.checkoutProjection(
      await this.stripe.checkout.sessions.retrieve(input.providerSessionRef),
    );
  }

  async createPortal(input: {
    providerCustomerRef: string;
    returnUrl: string;
    livemode: boolean;
  }): Promise<{ url: string }> {
    if (input.livemode || !CUSTOMER.test(input.providerCustomerRef)) {
      throw new StripeBillingProjectionError();
    }
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.providerCustomerRef,
      return_url: input.returnUrl,
    });
    if (session.customer !== input.providerCustomerRef || session.livemode) {
      throw new StripeBillingProjectionError();
    }
    return { url: safeUrl(session.url, "billing.stripe.com") };
  }

  async verify(
    rawBody: Uint8Array,
    signature: string,
  ): Promise<CanonicalBillingSubscriptionEvent> {
    let rawEvent: unknown;
    try {
      rawEvent = await this.stripe.webhooks.constructEventAsync(
        Buffer.from(rawBody), signature, this.webhookSecret,
      );
    } catch {
      throw new StripeWebhookVerificationError();
    }
    const event = objectRecord(rawEvent);
    const data = objectRecord(event.data);
    const subscription = objectRecord(data.object);
    const items = objectRecord(subscription.items);
    if (
      typeof event.id !== "string" || !EVENT.test(event.id) ||
      typeof event.type !== "string" || !EVENT_TYPES.has(event.type as BillingEventType) ||
      event.livemode !== false || typeof event.created !== "number" ||
      !Number.isSafeInteger(event.created) || event.created < 1 ||
      typeof subscription.id !== "string" || !SUBSCRIPTION.test(subscription.id) ||
      subscription.livemode !== false || typeof subscription.status !== "string" ||
      !STATUSES.has(subscription.status as BillingSubscriptionStatus) ||
      typeof subscription.cancel_at_period_end !== "boolean" ||
      !Array.isArray(items.data) || items.data.length !== 1
    ) throw new StripeBillingProjectionError();
    const item = objectRecord(items.data[0]);
    const price = objectRecord(item.price);
    const offer = [...this.offers.entries()].find(([, ref]) => ref === price.id);
    if (
      !offer || offer[0] !== "person" || typeof item.current_period_start !== "number" ||
      typeof item.current_period_end !== "number" ||
      !Number.isSafeInteger(item.current_period_start) ||
      !Number.isSafeInteger(item.current_period_end) ||
      item.current_period_start < 1 || item.current_period_end <= item.current_period_start ||
      (event.type === "customer.subscription.deleted" && subscription.status !== "canceled")
    ) throw new StripeBillingProjectionError();
    return {
      providerEventRef: event.id,
      eventType: event.type as BillingEventType,
      livemode: false,
      payloadHash: createHash("sha256").update(rawBody).digest(),
      providerCustomerRef: customerReference(subscription.customer),
      providerSubscriptionRef: subscription.id,
      offerCode: "person",
      subscriptionStatus: subscription.status as BillingSubscriptionStatus,
      currentPeriodStart: new Date(item.current_period_start * 1_000),
      currentPeriodEnd: new Date(item.current_period_end * 1_000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      providerCreatedAt: new Date(event.created * 1_000),
    };
  }

  private checkoutProjection(session: Stripe.Checkout.Session) {
    if (
      !SESSION.test(session.id) || session.mode !== "subscription" ||
      session.status !== "open" || typeof session.expires_at !== "number" ||
      !Number.isSafeInteger(session.expires_at) || session.expires_at < 1
    ) throw new StripeBillingProjectionError();
    return {
      providerSessionRef: session.id,
      providerCustomerRef: customerReference(session.customer),
      url: safeUrl(session.url, "checkout.stripe.com"),
      expiresAt: new Date(session.expires_at * 1_000),
    };
  }

  private validateTestCommand(
    tenantReference: string,
    idempotencyKey: string,
    livemode: boolean,
  ): void {
    if (livemode || !UUID.test(tenantReference) || !IDEMPOTENCY.test(idempotencyKey)) {
      throw new StripeBillingProjectionError();
    }
  }
}
