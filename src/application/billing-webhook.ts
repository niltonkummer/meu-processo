import type {
  BillingOfferCode,
  BillingSubscriptionStatus,
} from "./personal-billing.js";

export type BillingEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

export interface CanonicalBillingSubscriptionEvent {
  readonly providerEventRef: string;
  readonly eventType: BillingEventType;
  readonly livemode: boolean;
  readonly payloadHash: Uint8Array;
  readonly providerCustomerRef: string;
  readonly providerSubscriptionRef: string;
  readonly offerCode: BillingOfferCode;
  readonly subscriptionStatus: BillingSubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly providerCreatedAt: Date;
}

export interface BillingWebhookVerifier {
  verify(
    rawBody: Uint8Array,
    signature: string,
  ): Promise<CanonicalBillingSubscriptionEvent>;
}

export type BillingEventOutcome = "applied" | "duplicate" | "stale" | "ignored";

export interface BillingEventRepository {
  apply(
    event: CanonicalBillingSubscriptionEvent,
    receivedAt: Date,
  ): Promise<{ readonly outcome: BillingEventOutcome; readonly tenantId: string | null }>;
}

export class BillingWebhookValidationError extends Error {
  constructor() { super("Webhook de pagamento inválido."); this.name = "BillingWebhookValidationError"; }
}
export class BillingWebhookVerificationError extends Error {
  constructor() { super("Assinatura do webhook de pagamento inválida."); this.name = "BillingWebhookVerificationError"; }
}
export class BillingWebhookProjectionError extends Error {
  constructor() { super("Billing webhook projection is invalid."); this.name = "BillingWebhookProjectionError"; }
}

const EVENT = /^evt_[A-Za-z0-9]{8,255}$/;
const CUSTOMER = /^cus_[A-Za-z0-9]{8,255}$/;
const SUBSCRIPTION = /^sub_[A-Za-z0-9]{8,255}$/;
const EVENT_TYPES = new Set<BillingEventType>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const STATUSES = new Set<BillingSubscriptionStatus>([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due",
  "canceled", "unpaid", "paused",
]);
const OUTCOMES = new Set<BillingEventOutcome>([
  "applied", "duplicate", "stale", "ignored",
]);

const validDate = (value: Date): boolean =>
  value instanceof Date && !Number.isNaN(value.getTime());

const validateEvent = (event: CanonicalBillingSubscriptionEvent): void => {
  if (
    !EVENT.test(event.providerEventRef) || !EVENT_TYPES.has(event.eventType) ||
    event.livemode || event.payloadHash.byteLength !== 32 ||
    !CUSTOMER.test(event.providerCustomerRef) ||
    !SUBSCRIPTION.test(event.providerSubscriptionRef) ||
    event.offerCode !== "person" || !STATUSES.has(event.subscriptionStatus) ||
    !validDate(event.currentPeriodStart) || !validDate(event.currentPeriodEnd) ||
    event.currentPeriodEnd.getTime() <= event.currentPeriodStart.getTime() ||
    typeof event.cancelAtPeriodEnd !== "boolean" ||
    !validDate(event.providerCreatedAt) ||
    (event.eventType === "customer.subscription.deleted" &&
      event.subscriptionStatus !== "canceled")
  ) throw new BillingWebhookProjectionError();
};

export class BillingWebhook {
  constructor(
    private readonly verifier: BillingWebhookVerifier,
    private readonly repository: BillingEventRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handle(rawBody: Uint8Array, signature: string): Promise<{
    readonly outcome: BillingEventOutcome;
  }> {
    if (
      rawBody.byteLength < 1 || rawBody.byteLength > 262_144 ||
      signature.length < 1 || signature.length > 1_024
    ) throw new BillingWebhookValidationError();
    const event = await this.verifier.verify(rawBody, signature);
    validateEvent(event);
    const receivedAt = this.now();
    if (!validDate(receivedAt)) throw new BillingWebhookProjectionError();
    const result = await this.repository.apply(event, receivedAt);
    if (!OUTCOMES.has(result.outcome)) throw new BillingWebhookProjectionError();
    return { outcome: result.outcome };
  }
}
