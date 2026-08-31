import { describe, expect, it, vi } from "vitest";

import {
  OutboxDispatcher,
  OutboxDispatcherConfigurationError,
  type ClaimedOutboxEvent,
  type OutboxDispatcherConfig,
  type OutboxRepository,
} from "./outbox-dispatcher.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const EVENT_A = "90000000-0000-7000-8000-000000000001";
const EVENT_B = "90000000-0000-7000-8000-000000000002";

const config: OutboxDispatcherConfig = {
  workerId: "dispatcher-test",
  batchSize: 10,
  leaseDurationMs: 60_000,
  baseBackoffMs: 60_000,
  maxBackoffMs: 3_600_000,
  maxAttempts: 3,
};

const claim = (
  eventId: string,
  attemptCount = 1,
): ClaimedOutboxEvent => ({
  eventId,
  tenantId: "10000000-0000-7000-8000-000000000001",
  eventType: "monitoring.completed.v1",
  aggregateType: "monitoring_target",
  aggregateId: "20000000-0000-7000-8000-000000000001",
  correlationId: "30000000-0000-7000-8000-000000000001",
  payload: { executionId: "80000000-0000-7000-8000-000000000001" },
  attemptCount,
  leaseToken: `lease-token-${eventId}`,
});

const repository = (
  claims: readonly ClaimedOutboxEvent[],
): OutboxRepository => ({
  claimDue: vi.fn().mockResolvedValue(claims),
  complete: vi.fn().mockResolvedValue(undefined),
  fail: vi.fn().mockResolvedValue(undefined),
});

describe("OutboxDispatcher", () => {
  it.each([
    { ...config, workerId: "" },
    { ...config, workerId: "x".repeat(101) },
    { ...config, workerId: "invalid worker" },
    { ...config, batchSize: 0 },
    { ...config, batchSize: 26 },
    { ...config, batchSize: 1.5 },
    { ...config, leaseDurationMs: 29_999 },
    { ...config, leaseDurationMs: 900_001 },
    { ...config, baseBackoffMs: 59_999 },
    { ...config, baseBackoffMs: 86_400_001 },
    { ...config, maxBackoffMs: 59_999 },
    { ...config, maxBackoffMs: 86_400_001 },
    { ...config, maxBackoffMs: 60_000, baseBackoffMs: 60_001 },
    { ...config, maxAttempts: 0 },
    { ...config, maxAttempts: 21 },
    { ...config, maxAttempts: 1.5 },
  ])("rejects an unsafe configuration %#", (unsafeConfig) => {
    expect(
      () =>
        new OutboxDispatcher(
          repository([]),
          { publish: vi.fn() },
          vi.fn(),
          unsafeConfig,
          () => NOW,
        ),
    ).toThrow(OutboxDispatcherConfigurationError);
  });

  it("returns an empty summary without calling the publisher", async () => {
    const store = repository([]);
    const publish = vi.fn();
    const metrics = vi.fn();
    const dispatcher = new OutboxDispatcher(
      store,
      { publish },
      metrics,
      config,
      () => NOW,
    );

    await expect(dispatcher.runTick()).resolves.toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 0,
    });
    expect(store.claimDue).toHaveBeenCalledWith({
      workerId: "dispatcher-test",
      now: NOW,
      limit: 10,
      leaseDurationMs: 60_000,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(metrics).not.toHaveBeenCalled();
  });

  it("uses the system clock when no clock is injected", async () => {
    const store = repository([]);
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn() },
      vi.fn(),
      config,
    );

    await dispatcher.runTick();
    expect(store.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ now: expect.any(Date) }),
    );
  });

  it("publishes the minimized event with eventId as idempotency key", async () => {
    const item = claim(EVENT_A);
    const store = repository([item]);
    const publish = vi.fn().mockResolvedValue(undefined);
    const metrics = vi.fn();
    const dispatcher = new OutboxDispatcher(
      store,
      { publish },
      metrics,
      config,
      () => NOW,
    );

    await expect(dispatcher.runTick()).resolves.toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 0,
    });
    expect(publish).toHaveBeenCalledWith({
      eventId: EVENT_A,
      tenantId: item.tenantId,
      eventType: item.eventType,
      aggregateType: item.aggregateType,
      aggregateId: item.aggregateId,
      correlationId: item.correlationId,
      payload: item.payload,
      idempotencyKey: EVENT_A,
    });
    expect(store.complete).toHaveBeenCalledWith({
      eventId: EVENT_A,
      leaseToken: item.leaseToken,
      completedAt: NOW,
    });
    expect(store.fail).not.toHaveBeenCalled();
    expect(metrics).toHaveBeenCalledWith({
      eventId: EVENT_A,
      eventType: item.eventType,
      attemptCount: 1,
      outcome: "published",
    });
  });

  it("retries a failed publication with bounded exponential backoff", async () => {
    const item = claim(EVENT_A, 2);
    const store = repository([item]);
    const metrics = vi.fn();
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue(new Error("destination unavailable")) },
      metrics,
      config,
      () => NOW,
    );

    await expect(dispatcher.runTick()).resolves.toEqual({
      claimed: 1,
      published: 0,
      retried: 1,
      dead: 0,
      acknowledgementFailed: 0,
    });
    expect(store.fail).toHaveBeenCalledWith({
      eventId: EVENT_A,
      leaseToken: item.leaseToken,
      failedAt: NOW,
      failureCode: "OUTBOX_PUBLISH_FAILED",
      nextAttemptAt: new Date("2026-08-31T12:02:00.000Z"),
      terminal: false,
    });
    expect(metrics).toHaveBeenCalledWith({
      eventId: EVENT_A,
      eventType: item.eventType,
      attemptCount: 2,
      outcome: "retry_scheduled",
      failureCode: "OUTBOX_PUBLISH_FAILED",
    });
  });

  it("moves the event to dead exactly at the configured attempt limit", async () => {
    const item = claim(EVENT_A, 3);
    const store = repository([item]);
    const metrics = vi.fn();
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue("safe opaque failure") },
      metrics,
      config,
      () => NOW,
    );

    await expect(dispatcher.runTick()).resolves.toEqual({
      claimed: 1,
      published: 0,
      retried: 0,
      dead: 1,
      acknowledgementFailed: 0,
    });
    expect(store.fail).toHaveBeenCalledWith({
      eventId: EVENT_A,
      leaseToken: item.leaseToken,
      failedAt: NOW,
      failureCode: "OUTBOX_PUBLISH_FAILED",
      nextAttemptAt: null,
      terminal: true,
    });
    expect(metrics).toHaveBeenCalledWith({
      eventId: EVENT_A,
      eventType: item.eventType,
      attemptCount: 3,
      outcome: "dead",
      failureCode: "OUTBOX_PUBLISH_FAILED",
    });
  });

  it("contains backoff at the configured maximum", async () => {
    const item = claim(EVENT_A, 10);
    const store = repository([item]);
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue(new Error("failure")) },
      vi.fn(),
      { ...config, maxAttempts: 20, maxBackoffMs: 120_000 },
      () => NOW,
    );

    await dispatcher.runTick();
    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        nextAttemptAt: new Date("2026-08-31T12:02:00.000Z"),
        terminal: false,
      }),
    );
  });

  it("continues the batch and reports acknowledgement failures safely", async () => {
    const first = claim(EVENT_A);
    const second = claim(EVENT_B);
    const store = repository([first, second]);
    vi.mocked(store.complete)
      .mockRejectedValueOnce(new Error("lease conflict"))
      .mockResolvedValueOnce(undefined);
    const metrics = vi.fn().mockImplementationOnce(() => {
      throw new Error("metrics must be fail-safe");
    });
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockResolvedValue(undefined) },
      metrics,
      config,
      () => NOW,
    );

    await expect(dispatcher.runTick()).resolves.toEqual({
      claimed: 2,
      published: 1,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 1,
    });
    expect(store.fail).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledTimes(2);
  });

  it("reports a failed retry acknowledgement without exposing the error", async () => {
    const item = claim(EVENT_A);
    const store = repository([item]);
    vi.mocked(store.fail).mockRejectedValue(new Error("database details"));
    const metrics = vi.fn();
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue(new Error("publisher details")) },
      metrics,
      config,
      () => NOW,
    );

    await expect(dispatcher.runTick()).resolves.toEqual({
      claimed: 1,
      published: 0,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 1,
    });
    expect(metrics).toHaveBeenCalledWith({
      eventId: EVENT_A,
      eventType: item.eventType,
      attemptCount: 1,
      outcome: "acknowledgement_failed",
    });
  });

  it("fails before claiming when the injected clock is invalid", async () => {
    const store = repository([]);
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn() },
      vi.fn(),
      config,
      () => new Date(Number.NaN),
    );

    await expect(dispatcher.runTick()).rejects.toThrow(
      OutboxDispatcherConfigurationError,
    );
    expect(store.claimDue).not.toHaveBeenCalled();
  });
});
