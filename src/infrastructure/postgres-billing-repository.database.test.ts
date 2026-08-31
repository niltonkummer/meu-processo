import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BillingProjectionError } from "../application/personal-billing.js";
import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import {
  PostgresBillingEventRepository,
  PostgresBillingRepository,
} from "./postgres-billing-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
const webhookUrl = process.env.BILLING_WEBHOOK_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !webhookUrl) {
  throw new Error("Billing database URLs are required.");
}
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 4 });
const webhookPool = new Pool({ connectionString: webhookUrl, max: 2 });
const runtime = new PostgresBillingRepository(runtimePool);
const webhook = new PostgresBillingEventRepository(webhookPool);

const USER = "00000000-0000-7000-8000-000000000751";
const TENANT = "10000000-0000-7000-8000-000000000751";
const OTHER_USER = "00000000-0000-7000-8000-000000000752";
const OTHER_TENANT = "10000000-0000-7000-8000-000000000752";
const context = { userId: USER, tenantId: TENANT };
const other = { userId: OTHER_USER, tenantId: OTHER_TENANT };

beforeAll(async () => {
  for (const [user, tenant, subject] of [
    [USER, TENANT, "billing-user"],
    [OTHER_USER, OTHER_TENANT, "billing-other"],
  ]) {
    await admin.query(
      "insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)",
      [user, subject],
    );
    await admin.query(
      "insert into app_private.tenants(tenant_id,tenant_kind,personal_owner_user_id) values($1,'personal',$2)",
      [tenant, user],
    );
    await admin.query(
      "insert into app_private.tenant_members(tenant_id,user_id,membership_role) values($1,$2,'owner')",
      [tenant, user],
    );
  }
});

afterAll(async () => {
  await Promise.all([admin.end(), runtimePool.end(), webhookPool.end()]);
});

describe("Postgres billing repositories", () => {
  it("binds tenant customers and reserves/completes an idempotent checkout", async () => {
    await expect(runtime.getState(context)).resolves.toBeNull();
    await expect(runtime.bindCustomer(context, {
      provider: "stripe", providerCustomerRef: "cus_12345678AAA",
      livemode: false, createdAt: new Date("2026-08-31T15:00:00Z"),
    })).resolves.toEqual({
      outcome: "created", providerCustomerRef: "cus_12345678AAA",
    });
    await expect(runtime.bindCustomer(context, {
      provider: "stripe", providerCustomerRef: "cus_12345678AAA",
      livemode: false, createdAt: new Date("2026-08-31T15:00:00Z"),
    })).resolves.toMatchObject({ outcome: "existing" });
    const requestId = "20000000-0000-7000-8000-000000000751";
    await expect(runtime.reserveCheckout(context, {
      requestId, offerCode: "person",
      requestedAt: new Date("2026-08-31T15:01:00Z"),
    })).resolves.toMatchObject({
      outcome: "reserved", providerCustomerRef: "cus_12345678AAA",
      providerSessionRef: null,
    });
    await expect(runtime.completeCheckout(context, {
      requestId, providerSessionRef: "cs_test_12345678AAA",
      completedAt: new Date("2026-08-31T15:02:00Z"),
      expiresAt: new Date("2026-08-31T15:30:00Z"),
    })).resolves.toMatchObject({
      outcome: "created", providerSessionRef: "cs_test_12345678AAA",
    });
    await expect(runtime.reserveCheckout(context, {
      requestId, offerCode: "person",
      requestedAt: new Date("2026-08-31T15:03:00Z"),
    })).resolves.toMatchObject({
      outcome: "created", providerSessionRef: "cs_test_12345678AAA",
    });
  });

  it("applies, deduplicates and orders subscription events", async () => {
    const base = {
      providerEventRef: "evt_12345678AAA",
      eventType: "customer.subscription.created" as const,
      livemode: false,
      payloadHash: Buffer.alloc(32, 1),
      providerCustomerRef: "cus_12345678AAA",
      providerSubscriptionRef: "sub_12345678AAA",
      offerCode: "person" as const,
      subscriptionStatus: "active" as const,
      currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      providerCreatedAt: new Date("2026-08-31T15:05:00Z"),
    };
    await expect(webhook.apply(base, new Date("2026-08-31T15:05:01Z")))
      .resolves.toEqual({ outcome: "applied", tenantId: TENANT });
    await expect(webhook.apply(base, new Date("2026-08-31T15:05:02Z")))
      .resolves.toEqual({ outcome: "duplicate", tenantId: TENANT });
    await expect(webhook.apply({
      ...base,
      providerEventRef: "evt_12345678AAB",
      eventType: "customer.subscription.updated",
      subscriptionStatus: "past_due",
      providerCreatedAt: new Date("2026-08-31T15:04:00Z"),
    }, new Date("2026-08-31T15:06:00Z")))
      .resolves.toEqual({ outcome: "stale", tenantId: TENANT });
    await expect(runtime.getState(context)).resolves.toMatchObject({
      providerCustomerRef: "cus_12345678AAA",
      providerSubscriptionRef: "sub_12345678AAA",
      offerCode: "person", status: "active",
    });
  });

  it("ignores unknown customers and prevents cross-tenant bindings", async () => {
    await expect(webhook.apply({
      providerEventRef: "evt_12345678AAC",
      eventType: "customer.subscription.created",
      livemode: false,
      payloadHash: Buffer.alloc(32, 2),
      providerCustomerRef: "cus_12345678ZZZ",
      providerSubscriptionRef: "sub_12345678ZZZ",
      offerCode: "person",
      subscriptionStatus: "active",
      currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      providerCreatedAt: new Date("2026-08-31T15:07:00Z"),
    }, new Date("2026-08-31T15:07:01Z")))
      .resolves.toEqual({ outcome: "ignored", tenantId: null });
    await expect(runtime.bindCustomer(other, {
      provider: "stripe", providerCustomerRef: "cus_12345678AAA",
      livemode: false, createdAt: new Date("2026-08-31T15:08:00Z"),
    })).rejects.toBeInstanceOf(BillingProjectionError);
    await expect(runtime.getState(other)).resolves.toBeNull();
    await expect(runtime.getState({ userId: OTHER_USER, tenantId: TENANT }))
      .rejects.toBeInstanceOf(RepositoryAccessDeniedError);
  });

  it("denies direct table access to both workload roles", async () => {
    for (const table of [
      "billing_customers", "billing_subscriptions", "billing_events",
      "checkout_attempts",
    ]) {
      await expect(runtimePool.query(`select * from app_private.${table}`))
        .rejects.toMatchObject({ code: "42501" });
      await expect(webhookPool.query(`select * from app_private.${table}`))
        .rejects.toMatchObject({ code: "42501" });
    }
  });
});
