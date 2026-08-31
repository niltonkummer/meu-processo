import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  BillingRuntimeConfig,
  FoundationRuntimeConfig,
} from "../configuration/runtime-config.js";
import { composeBilling } from "./billing-composition-root.js";

const billingConfig: Extract<BillingRuntimeConfig, { mode: "stripe-test" }> = {
  mode: "stripe-test",
  applicationUrl: "https://validation.meu-processo.example",
  webhookDatabaseUrl:
    "postgresql://app_billing_webhook:password@database/meu_processo",
  stripeSecretKey: "sk_test_1234567890abcdefghijklmnop",
  stripeWebhookSecret: "whsec_1234567890abcdefghijklmnop",
  personPriceId: "price_12345678ABC",
};
const foundationConfig: Extract<FoundationRuntimeConfig, { mode: "postgres" }> = {
  mode: "postgres",
  databaseUrl: "postgresql://runtime:password@database/meu_processo",
  poolMax: 5,
  activeKeyVersion: "v1",
  encryptionKeys: new Map([["v1", Buffer.alloc(32, 1)]]),
  blindIndexVersion: "v1",
  blindIndexKey: Buffer.alloc(32, 2),
};

const fakePool = () => ({ end: vi.fn().mockResolvedValue(undefined) }) as unknown as Pool;

describe("billing composition root", () => {
  it("keeps billing absent when disabled", async () => {
    const openPool = vi.fn();
    const composed = composeBilling(
      { mode: "disabled" },
      { mode: "disabled" },
      { openPool },
    );
    expect(composed.billing).toBeUndefined();
    expect(composed.billingWebhook).toBeUndefined();
    expect(openPool).not.toHaveBeenCalled();
    await expect(composed.close()).resolves.toBeUndefined();
  });

  it("fails closed without the PostgreSQL foundation", () => {
    expect(() => composeBilling(
      billingConfig,
      { mode: "disabled" },
      { openPool: vi.fn() },
    )).toThrow("Billing requires the PostgreSQL foundation.");
  });

  it("opens separate least-privilege pools and closes both", async () => {
    const runtimePool = fakePool();
    const webhookPool = fakePool();
    const openPool = vi.fn()
      .mockReturnValueOnce(runtimePool)
      .mockReturnValueOnce(webhookPool);
    const composed = composeBilling(billingConfig, foundationConfig, { openPool });

    expect(composed.billing).toBeDefined();
    expect(composed.billingWebhook).toBeDefined();
    expect(openPool).toHaveBeenNthCalledWith(1, {
      connectionString: foundationConfig.databaseUrl,
      max: 2,
      workload: "api",
    });
    expect(openPool).toHaveBeenNthCalledWith(2, {
      connectionString: billingConfig.webhookDatabaseUrl,
      max: 2,
      workload: "billing-webhook",
    });

    await composed.close();
    expect(runtimePool.end).toHaveBeenCalledOnce();
    expect(webhookPool.end).toHaveBeenCalledOnce();
  });

  it("supports the production pool factory without opening a connection", async () => {
    const composed = composeBilling(billingConfig, foundationConfig);
    expect(composed.billing).toBeDefined();
    expect(composed.billingWebhook).toBeDefined();
    await expect(composed.close()).resolves.toBeUndefined();
  });
});
