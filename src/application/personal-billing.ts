import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export type BillingOfferCode = "person";
export type BillingSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export interface BillingState {
  readonly providerCustomerRef: string;
  readonly providerSubscriptionRef: string | null;
  readonly offerCode: BillingOfferCode | null;
  readonly status: BillingSubscriptionStatus | null;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
}

export interface BillingRepository {
  getState(context: RepositoryContext): Promise<BillingState | null>;
  bindCustomer(context: RepositoryContext, input: {
    readonly provider: "stripe";
    readonly providerCustomerRef: string;
    readonly livemode: boolean;
    readonly createdAt: Date;
  }): Promise<{ readonly outcome: "created" | "existing"; readonly providerCustomerRef: string }>;
  reserveCheckout(context: RepositoryContext, input: {
    readonly requestId: string;
    readonly offerCode: BillingOfferCode;
    readonly requestedAt: Date;
  }): Promise<{
    readonly outcome: "reserved" | "created" | "expired";
    readonly providerCustomerRef: string;
    readonly providerSessionRef: string | null;
    readonly expiresAt: Date;
  }>;
  completeCheckout(context: RepositoryContext, input: {
    readonly requestId: string;
    readonly providerSessionRef: string;
    readonly completedAt: Date;
    readonly expiresAt: Date;
  }): Promise<{
    readonly outcome: "created" | "existing";
    readonly providerSessionRef: string;
    readonly expiresAt: Date;
  }>;
}

export interface BillingProvider {
  createCustomer(input: {
    readonly tenantReference: string;
    readonly idempotencyKey: string;
    readonly livemode: boolean;
  }): Promise<{ readonly providerCustomerRef: string }>;
  createCheckout(input: {
    readonly providerCustomerRef: string;
    readonly priceReference: string;
    readonly offerCode: BillingOfferCode;
    readonly tenantReference: string;
    readonly idempotencyKey: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly livemode: boolean;
  }): Promise<{
    readonly providerSessionRef: string;
    readonly providerCustomerRef: string;
    readonly url: string;
    readonly expiresAt: Date;
  }>;
  retrieveCheckout(input: {
    readonly providerSessionRef: string;
    readonly livemode: boolean;
  }): Promise<{
    readonly providerSessionRef: string;
    readonly providerCustomerRef: string;
    readonly url: string;
    readonly expiresAt: Date;
  }>;
  createPortal(input: {
    readonly providerCustomerRef: string;
    readonly returnUrl: string;
    readonly livemode: boolean;
  }): Promise<{ readonly url: string }>;
}

export interface BillingProjection {
  readonly plan: "free" | BillingOfferCode;
  readonly status: "free" | BillingSubscriptionStatus;
  readonly entitled: boolean;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

export interface PersonalBillingService {
  getSubscription(providerSubject: string): Promise<BillingProjection>;
  createCheckout(providerSubject: string, command: unknown): Promise<{
    readonly url: string;
    readonly expiresAt: string;
  }>;
  createPortal(providerSubject: string): Promise<{ readonly url: string }>;
}

export class BillingConfigurationError extends Error {
  constructor() { super("Billing configuration is invalid."); this.name = "BillingConfigurationError"; }
}
export class BillingValidationError extends Error {
  constructor() { super("Solicitação de assinatura inválida."); this.name = "BillingValidationError"; }
}
export class BillingProjectionError extends Error {
  constructor() { super("Billing projection is invalid."); this.name = "BillingProjectionError"; }
}
export class BillingAlreadySubscribedError extends Error {
  constructor() { super("A assinatura já está ativa."); this.name = "BillingAlreadySubscribedError"; }
}
export class BillingCheckoutUnavailableError extends Error {
  constructor() { super("A sessão de pagamento não está disponível."); this.name = "BillingCheckoutUnavailableError"; }
}
export class BillingPortalUnavailableError extends Error {
  constructor() { super("O portal de assinatura ainda não está disponível."); this.name = "BillingPortalUnavailableError"; }
}

interface BillingConfig {
  readonly livemode: boolean;
  readonly applicationUrl: string;
  readonly offers: ReadonlyMap<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER = /^cus_[A-Za-z0-9]{8,255}$/;
const SESSION = /^cs_test_[A-Za-z0-9]{8,255}$/;
const PRICE = /^price_[A-Za-z0-9]{8,255}$/;
const SUBSCRIPTION = /^sub_[A-Za-z0-9]{8,255}$/;
const STATUSES = new Set<BillingSubscriptionStatus>([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due",
  "canceled", "unpaid", "paused",
]);
const ENTITLED = new Set<BillingSubscriptionStatus>(["trialing", "active", "past_due"]);

const exactApplicationOrigin = (raw: string): URL => {
  try {
    const url = new URL(raw);
    const local = (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && url.protocol === "http:";
    if (
      (!local && url.protocol !== "https:") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash
    ) throw new BillingConfigurationError();
    return url;
  } catch (error) {
    if (error instanceof BillingConfigurationError) throw error;
    throw new BillingConfigurationError();
  }
};

const safeProviderUrl = (raw: string, host: string): string => {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.hostname !== host ||
      url.username || url.password || url.port || url.hash
    ) throw new BillingProjectionError();
    return url.toString();
  } catch (error) {
    if (error instanceof BillingProjectionError) throw error;
    throw new BillingProjectionError();
  }
};

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const validateState = (state: BillingState | null): void => {
  if (state === null) return;
  const subscriptionAbsent =
    state.providerSubscriptionRef === null && state.offerCode === null &&
    state.status === null && state.currentPeriodStart === null &&
    state.currentPeriodEnd === null;
  const subscriptionPresent =
    typeof state.providerSubscriptionRef === "string" &&
    SUBSCRIPTION.test(state.providerSubscriptionRef) &&
    state.offerCode === "person" && state.status !== null &&
    STATUSES.has(state.status) && state.currentPeriodStart instanceof Date &&
    validDate(state.currentPeriodStart) && state.currentPeriodEnd instanceof Date &&
    validDate(state.currentPeriodEnd) &&
    state.currentPeriodEnd.getTime() > state.currentPeriodStart.getTime();
  if (!CUSTOMER.test(state.providerCustomerRef) || (!subscriptionAbsent && !subscriptionPresent)) {
    throw new BillingProjectionError();
  }
};

const parseCommand = (value: unknown): { requestId: string; offerCode: BillingOfferCode } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BillingValidationError();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 || typeof record.requestId !== "string" ||
    !UUID.test(record.requestId) || record.offerCode !== "person"
  ) throw new BillingValidationError();
  return { requestId: record.requestId, offerCode: "person" };
};

export class PersonalBilling implements PersonalBillingService {
  private readonly applicationOrigin: URL;

  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
    private readonly config: BillingConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      config.livemode || config.offers.size !== 1 ||
      !PRICE.test(config.offers.get("person") ?? "")
    ) throw new BillingConfigurationError();
    this.applicationOrigin = exactApplicationOrigin(config.applicationUrl);
  }

  async getSubscription(providerSubject: string): Promise<BillingProjection> {
    const context = await this.contextResolver.resolve(providerSubject);
    const state = await this.repository.getState(context);
    validateState(state);
    if (state === null || state.status === null || state.offerCode === null) {
      return {
        plan: "free", status: "free", entitled: false,
        currentPeriodEnd: null, cancelAtPeriodEnd: false,
      };
    }
    const current = this.validNow();
    const entitled = ENTITLED.has(state.status)
      && state.currentPeriodEnd!.getTime() > current.getTime();
    return {
      plan: state.offerCode,
      status: state.status,
      entitled,
      currentPeriodEnd: state.currentPeriodEnd!.toISOString(),
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    };
  }

  async createCheckout(providerSubject: string, rawCommand: unknown): Promise<{
    readonly url: string;
    readonly expiresAt: string;
  }> {
    const command = parseCommand(rawCommand);
    const context = await this.contextResolver.resolve(providerSubject);
    const now = this.validNow();
    const state = await this.repository.getState(context);
    validateState(state);
    if (
      state?.status && ENTITLED.has(state.status) && state.currentPeriodEnd &&
      state.currentPeriodEnd.getTime() > now.getTime()
    ) throw new BillingAlreadySubscribedError();

    let providerCustomerRef = state?.providerCustomerRef;
    if (!providerCustomerRef) {
      const created = await this.provider.createCustomer({
        tenantReference: context.tenantId,
        idempotencyKey: `billing-customer:${context.tenantId}`,
        livemode: this.config.livemode,
      });
      if (!CUSTOMER.test(created.providerCustomerRef)) throw new BillingProjectionError();
      const binding = await this.repository.bindCustomer(context, {
        provider: "stripe", providerCustomerRef: created.providerCustomerRef,
        livemode: this.config.livemode, createdAt: now,
      });
      if (
        !["created", "existing"].includes(binding.outcome) ||
        !CUSTOMER.test(binding.providerCustomerRef)
      ) throw new BillingProjectionError();
      providerCustomerRef = binding.providerCustomerRef;
    }

    const reservation = await this.repository.reserveCheckout(context, {
      requestId: command.requestId,
      offerCode: command.offerCode,
      requestedAt: now,
    });
    if (
      reservation.providerCustomerRef !== providerCustomerRef ||
      !validDate(reservation.expiresAt)
    ) throw new BillingProjectionError();
    if (reservation.outcome === "expired") throw new BillingCheckoutUnavailableError();

    const checkout = reservation.outcome === "created"
      ? await this.retrieveCheckout(reservation.providerSessionRef)
      : await this.provider.createCheckout({
          providerCustomerRef,
          priceReference: this.config.offers.get(command.offerCode)!,
          offerCode: command.offerCode,
          tenantReference: context.tenantId,
          idempotencyKey: `billing-checkout:${context.tenantId}:${command.requestId}`,
          successUrl: new URL("?billing=success", this.applicationOrigin).toString(),
          cancelUrl: new URL("?billing=canceled", this.applicationOrigin).toString(),
          livemode: this.config.livemode,
        });
    this.validateCheckout(checkout, providerCustomerRef, now);
    if (reservation.outcome === "reserved") {
      const completion = await this.repository.completeCheckout(context, {
        requestId: command.requestId,
        providerSessionRef: checkout.providerSessionRef,
        completedAt: now,
        expiresAt: checkout.expiresAt,
      });
      if (
        completion.providerSessionRef !== checkout.providerSessionRef ||
        !validDate(completion.expiresAt)
      ) throw new BillingProjectionError();
    }
    return {
      url: safeProviderUrl(checkout.url, "checkout.stripe.com"),
      expiresAt: checkout.expiresAt.toISOString(),
    };
  }

  async createPortal(providerSubject: string): Promise<{ readonly url: string }> {
    const context = await this.contextResolver.resolve(providerSubject);
    const state = await this.repository.getState(context);
    validateState(state);
    if (!state) throw new BillingPortalUnavailableError();
    const result = await this.provider.createPortal({
      providerCustomerRef: state.providerCustomerRef,
      returnUrl: this.applicationOrigin.toString(),
      livemode: this.config.livemode,
    });
    return { url: safeProviderUrl(result.url, "billing.stripe.com") };
  }

  private retrieveCheckout(providerSessionRef: string | null) {
    if (!providerSessionRef || !SESSION.test(providerSessionRef)) {
      throw new BillingProjectionError();
    }
    return this.provider.retrieveCheckout({
      providerSessionRef,
      livemode: this.config.livemode,
    });
  }

  private validateCheckout(
    checkout: {
      providerSessionRef: string;
      providerCustomerRef: string;
      expiresAt: Date;
    },
    expectedCustomerRef: string,
    now: Date,
  ): void {
    if (
      !SESSION.test(checkout.providerSessionRef) || !validDate(checkout.expiresAt) ||
      checkout.providerCustomerRef !== expectedCustomerRef ||
      checkout.expiresAt.getTime() <= now.getTime() ||
      checkout.expiresAt.getTime() > now.getTime() + 86_400_000
    ) throw new BillingProjectionError();
  }

  private validNow(): Date {
    const value = this.now();
    if (!validDate(value)) throw new BillingProjectionError();
    return value;
  }
}
