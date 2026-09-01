import { BillingWebhook } from "../application/billing-webhook.js";
import { PersonalBilling, type PersonalBillingService } from "../application/personal-billing.js";
import { PersonalTenantResolver } from "../application/personal-tenant-resolver.js";
import type {
  BillingRuntimeConfig,
  FoundationRuntimeConfig,
} from "../configuration/runtime-config.js";
import { PostgresBillingEventRepository, PostgresBillingRepository } from
  "../infrastructure/postgres-billing-repository.js";
import { PostgresFoundationRepository } from
  "../infrastructure/postgres-foundation-repository.js";
import { openPostgresRuntimePool } from "../infrastructure/postgres-runtime-pool.js";
import { Sha256IdentityIdDeriver } from
  "../infrastructure/sha256-identity-id-deriver.js";
import { StripeBillingAdapter } from "../infrastructure/stripe-billing-adapter.js";

export interface ComposedBilling {
  readonly billing?: PersonalBillingService;
  readonly billingWebhook?: BillingWebhook;
  close(): Promise<void>;
}

interface BillingCompositionDependencies {
  readonly openPool?: typeof openPostgresRuntimePool;
}

export const composeBilling = (
  config: BillingRuntimeConfig,
  foundation: FoundationRuntimeConfig,
  dependencies: BillingCompositionDependencies = {},
): ComposedBilling => {
  if (config.mode === "disabled") return { close: () => Promise.resolve() };
  if (foundation.mode !== "postgres") {
    throw new Error("Billing requires the PostgreSQL foundation.");
  }

  const openPool = dependencies.openPool ?? openPostgresRuntimePool;
  const runtimePool = openPool({
    connectionString: foundation.databaseUrl,
    max: Math.min(foundation.poolMax, 2),
    workload: "api",
  });
  const webhookPool = openPool({
    connectionString: config.webhookDatabaseUrl,
    max: 2,
    workload: "billing-webhook",
  });
  const resolver = new PersonalTenantResolver(
    new PostgresFoundationRepository(runtimePool),
    new Sha256IdentityIdDeriver(),
  );
  const stripe = new StripeBillingAdapter({
    secretKey: config.stripeSecretKey,
    webhookSecret: config.stripeWebhookSecret,
    offers: new Map([["person", config.personPriceId]]),
  });
  return {
    billing: new PersonalBilling(
      resolver,
      new PostgresBillingRepository(runtimePool),
      stripe,
      {
        livemode: false,
        applicationUrl: config.applicationUrl,
        offers: new Map([["person", config.personPriceId]]),
      },
    ),
    billingWebhook: new BillingWebhook(
      stripe,
      new PostgresBillingEventRepository(webhookPool),
    ),
    close: async () => {
      await Promise.all([runtimePool.end(), webhookPool.end()]);
    },
  };
};
