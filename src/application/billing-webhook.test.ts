import { describe, expect, it, vi } from "vitest";

import {
  BillingWebhook,
  BillingWebhookProjectionError,
  BillingWebhookValidationError,
  type BillingEventRepository,
  type BillingWebhookVerifier,
} from "./billing-webhook.js";

const event = {
  providerEventRef: "evt_12345678ABC",
  eventType: "customer.subscription.updated" as const,
  livemode: false,
  payloadHash: Buffer.alloc(32, 1),
  providerCustomerRef: "cus_12345678ABC",
  providerSubscriptionRef: "sub_12345678ABC",
  offerCode: "person" as const,
  subscriptionStatus: "active" as const,
  currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
  providerCreatedAt: new Date("2026-08-31T15:00:00.000Z"),
};

const verifier = (): BillingWebhookVerifier => ({
  verify: vi.fn().mockResolvedValue(event),
});
const repository = (): BillingEventRepository => ({
  apply: vi.fn().mockResolvedValue({
    outcome: "applied", tenantId: "10000000-0000-7000-8000-000000000702",
  }),
});

describe("billing webhook", () => {
  it("verifies and applies one canonical event", async () => {
    const verify = verifier();
    const repo = repository();
    const receivedAt = new Date("2026-08-31T15:00:01.000Z");
    const handler = new BillingWebhook(verify, repo, () => receivedAt);
    const raw = Buffer.from('{"id":"evt_redacted"}');

    await expect(handler.handle(raw, "t=1,v1=safe")).resolves.toEqual({
      outcome: "applied",
    });
    expect(verify.verify).toHaveBeenCalledWith(raw, "t=1,v1=safe");
    expect(repo.apply).toHaveBeenCalledWith(event, receivedAt);
  });

  it.each(["duplicate", "stale", "ignored"] as const)(
    "returns safe outcome %s without tenant identifiers",
    async (outcome) => {
      const repo = repository();
      vi.mocked(repo.apply).mockResolvedValue({ outcome, tenantId: null });
      await expect(new BillingWebhook(verifier(), repo).handle(
        Buffer.from("{}"), "t=1,v1=safe",
      )).resolves.toEqual({ outcome });
    },
  );

  it.each([
    ["empty body", Buffer.alloc(0), "t=1,v1=safe"],
    ["large body", Buffer.alloc(262_145), "t=1,v1=safe"],
    ["empty signature", Buffer.from("{}"), ""],
    ["large signature", Buffer.from("{}"), "x".repeat(1_025)],
  ])("rejects %s before verification", async (_label, raw, signature) => {
    const verify = verifier();
    await expect(new BillingWebhook(verify, repository()).handle(raw, signature))
      .rejects.toBeInstanceOf(BillingWebhookValidationError);
    expect(verify.verify).not.toHaveBeenCalled();
  });

  it.each([
    ["event ref", { ...event, providerEventRef: "bad" }],
    ["live event", { ...event, livemode: true }],
    ["hash", { ...event, payloadHash: Buffer.alloc(31) }],
    ["customer", { ...event, providerCustomerRef: "bad" }],
    ["subscription", { ...event, providerSubscriptionRef: "bad" }],
    ["status", { ...event, subscriptionStatus: "unknown" }],
    ["period", { ...event, currentPeriodEnd: event.currentPeriodStart }],
    ["deleted mismatch", {
      ...event, eventType: "customer.subscription.deleted",
      subscriptionStatus: "active",
    }],
  ])("rejects unsafe canonical projection: %s", async (_label, invalid) => {
    const verify = verifier();
    vi.mocked(verify.verify).mockResolvedValue(invalid as typeof event);
    await expect(new BillingWebhook(verify, repository()).handle(
      Buffer.from("{}"), "t=1,v1=safe",
    )).rejects.toBeInstanceOf(BillingWebhookProjectionError);
  });

  it("rejects an invalid injected clock before persistence", async () => {
    const repo = repository();
    await expect(new BillingWebhook(
      verifier(), repo, () => new Date(Number.NaN),
    ).handle(Buffer.from("{}"), "t=1,v1=safe"))
      .rejects.toBeInstanceOf(BillingWebhookProjectionError);
    expect(repo.apply).not.toHaveBeenCalled();
  });

  it("rejects an unknown persistence outcome", async () => {
    const repo = repository();
    vi.mocked(repo.apply).mockResolvedValue({
      outcome: "unknown" as never, tenantId: null,
    });
    await expect(new BillingWebhook(verifier(), repo).handle(
      Buffer.from("{}"), "t=1,v1=safe",
    )).rejects.toBeInstanceOf(BillingWebhookProjectionError);
  });
});
