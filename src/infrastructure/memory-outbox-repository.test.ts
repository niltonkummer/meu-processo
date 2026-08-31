import { describe, expect, it } from "vitest";

import {
  OutboxDeliveryConflictError,
  OutboxDeliveryValidationError,
  type OutboxEvent,
} from "../application/outbox-dispatcher.js";
import { MemoryOutboxRepository } from "./memory-outbox-repository.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const EVENT_A = "90000000-0000-7000-8000-000000000001";
const EVENT_B = "90000000-0000-7000-8000-000000000002";
const EVENT_C = "90000000-0000-7000-8000-000000000003";

const event = (eventId: string): OutboxEvent => ({
  eventId,
  tenantId: "10000000-0000-7000-8000-000000000001",
  eventType: "monitoring.completed.v1",
  aggregateType: "monitoring_target",
  aggregateId: "20000000-0000-7000-8000-000000000001",
  correlationId: "30000000-0000-7000-8000-000000000001",
  payload: { count: 1 },
});

describe("MemoryOutboxRepository", () => {
  it("claims due events in stable order without duplicate concurrent leases", async () => {
    let token = 0;
    const store = new MemoryOutboxRepository(
      [
        { ...event(EVENT_B), availableAt: new Date(NOW.getTime() - 1_000) },
        { ...event(EVENT_A), availableAt: new Date(NOW.getTime() - 1_000) },
        { ...event(EVENT_C), availableAt: new Date(NOW.getTime() + 1_000) },
      ],
      () => `memory-lease-token-${++token}`,
    );

    const [first, second] = await Promise.all([
      store.claimDue({
        workerId: "dispatcher-a",
        now: NOW,
        limit: 1,
        leaseDurationMs: 60_000,
      }),
      store.claimDue({
        workerId: "dispatcher-b",
        now: NOW,
        limit: 2,
        leaseDurationMs: 60_000,
      }),
    ]);

    expect(first.map((item) => item.eventId)).toEqual([EVENT_A]);
    expect(second.map((item) => item.eventId)).toEqual([EVENT_B]);
    expect(first[0]?.attemptCount).toBe(1);
    expect(second[0]?.attemptCount).toBe(1);
    expect((await store.claimDue({
      workerId: "dispatcher-c",
      now: NOW,
      limit: 3,
      leaseDurationMs: 60_000,
    }))).toEqual([]);
  });

  it("reclaims an expired lease with the same event id and rejects the old token", async () => {
    let token = 0;
    const store = new MemoryOutboxRepository(
      [{ ...event(EVENT_A), availableAt: NOW }],
      () => `memory-lease-token-${++token}`,
    );
    const first = (await store.claimDue({
      workerId: "dispatcher-a",
      now: NOW,
      limit: 1,
      leaseDurationMs: 30_000,
    }))[0]!;
    const reclaimedAt = new Date(NOW.getTime() + 30_001);
    const second = (await store.claimDue({
      workerId: "dispatcher-b",
      now: reclaimedAt,
      limit: 1,
      leaseDurationMs: 30_000,
    }))[0]!;

    expect(second.eventId).toBe(first.eventId);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(second.attemptCount).toBe(2);
    await expect(store.complete({
      eventId: EVENT_A,
      leaseToken: first.leaseToken,
      completedAt: reclaimedAt,
    })).rejects.toBeInstanceOf(OutboxDeliveryConflictError);
  });

  it("completes idempotently with the current token", async () => {
    const store = new MemoryOutboxRepository(
      [{ ...event(EVENT_A), availableAt: NOW }],
      () => "memory-lease-token-current",
    );
    const item = (await store.claimDue({
      workerId: "dispatcher-a",
      now: NOW,
      limit: 1,
      leaseDurationMs: 60_000,
    }))[0]!;
    const command = {
      eventId: EVENT_A,
      leaseToken: item.leaseToken,
      completedAt: NOW,
    };

    await expect(store.complete(command)).resolves.toBeUndefined();
    await expect(store.complete(command)).resolves.toBeUndefined();
    await expect(store.complete({
      ...command,
      leaseToken: "memory-lease-token-different",
    })).rejects.toBeInstanceOf(OutboxDeliveryConflictError);
    expect(store.inspect(EVENT_A)).toEqual({
      status: "published",
      attemptCount: 1,
      availableAt: NOW,
      publishedAt: NOW,
      failureCode: null,
      lease: null,
    });
  });

  it("retries and terminates idempotently without accepting a stale outcome", async () => {
    let token = 0;
    const store = new MemoryOutboxRepository(
      [{ ...event(EVENT_A), availableAt: NOW }],
      () => `memory-lease-token-${++token}`,
    );
    const first = (await store.claimDue({
      workerId: "dispatcher-a",
      now: NOW,
      limit: 1,
      leaseDurationMs: 60_000,
    }))[0]!;
    const retryAt = new Date(NOW.getTime() + 60_000);
    const retry = {
      eventId: EVENT_A,
      leaseToken: first.leaseToken,
      failedAt: NOW,
      failureCode: "OUTBOX_PUBLISH_FAILED",
      nextAttemptAt: retryAt,
      terminal: false,
    } as const;
    await expect(store.fail(retry)).resolves.toBeUndefined();
    await expect(store.fail(retry)).resolves.toBeUndefined();
    expect(await store.claimDue({
      workerId: "dispatcher-b",
      now: new Date(retryAt.getTime() - 1),
      limit: 1,
      leaseDurationMs: 60_000,
    })).toEqual([]);

    const second = (await store.claimDue({
      workerId: "dispatcher-b",
      now: retryAt,
      limit: 1,
      leaseDurationMs: 60_000,
    }))[0]!;
    await expect(store.fail(retry)).rejects.toBeInstanceOf(
      OutboxDeliveryConflictError,
    );
    const terminal = {
      eventId: EVENT_A,
      leaseToken: second.leaseToken,
      failedAt: retryAt,
      failureCode: "OUTBOX_PUBLISH_FAILED",
      nextAttemptAt: null,
      terminal: true,
    } as const;
    await expect(store.fail(terminal)).resolves.toBeUndefined();
    await expect(store.fail(terminal)).resolves.toBeUndefined();
    expect(store.inspect(EVENT_A)).toEqual({
      status: "dead",
      attemptCount: 2,
      availableAt: retryAt,
      publishedAt: null,
      failureCode: "OUTBOX_PUBLISH_FAILED",
      lease: null,
    });
  });

  it("rejects malformed commands and missing events", async () => {
    const store = new MemoryOutboxRepository([], () => "short");
    await expect(store.claimDue({
      workerId: "invalid worker",
      now: NOW,
      limit: 1,
      leaseDurationMs: 60_000,
    })).rejects.toBeInstanceOf(OutboxDeliveryValidationError);
    await expect(store.claimDue({
      workerId: "dispatcher",
      now: NOW,
      limit: 1,
      leaseDurationMs: 60_000,
    })).resolves.toEqual([]);

    const seeded = new MemoryOutboxRepository(
      [{ ...event(EVENT_A), availableAt: NOW }],
      () => "short",
    );
    await expect(seeded.claimDue({
      workerId: "dispatcher",
      now: NOW,
      limit: 1,
      leaseDurationMs: 60_000,
    })).rejects.toBeInstanceOf(OutboxDeliveryValidationError);
    await expect(store.complete({
      eventId: EVENT_A,
      leaseToken: "long-enough-lease-token",
      completedAt: NOW,
    })).rejects.toBeInstanceOf(OutboxDeliveryConflictError);
    await expect(store.fail({
      eventId: EVENT_A,
      leaseToken: "long-enough-lease-token",
      failedAt: NOW,
      failureCode: "bad",
      nextAttemptAt: null,
      terminal: true,
    })).rejects.toBeInstanceOf(OutboxDeliveryValidationError);
  });
});
