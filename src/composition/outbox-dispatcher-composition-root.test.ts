import { describe, expect, it, vi } from "vitest";

import type {
  ClaimedOutboxEvent,
  OutboxRepository,
} from "../application/outbox-dispatcher.js";
import { composeOutboxDispatcher } from "./outbox-dispatcher-composition-root.js";

const config = {
  databaseUrl: "postgresql://dispatcher:password@database/meu_processo",
  poolMax: 3,
  dispatcher: {
    workerId: "dispatcher-local",
    batchSize: 4,
    leaseDurationMs: 60_000,
    baseBackoffMs: 60_000,
    maxBackoffMs: 3_600_000,
    maxAttempts: 5,
  },
} as const;

const claimed: ClaimedOutboxEvent = {
  eventId: "90000000-0000-7000-8000-000000000001",
  tenantId: "10000000-0000-7000-8000-000000000001",
  eventType: "monitoring.completed.v1",
  aggregateType: "monitoring_target",
  aggregateId: "20000000-0000-7000-8000-000000000001",
  correlationId: "30000000-0000-7000-8000-000000000001",
  payload: { count: 1 },
  attemptCount: 1,
  leaseToken: "composition-lease-token-safe",
};

describe("outbox dispatcher composition root", () => {
  it("opens the restricted repository, publishes and closes it", async () => {
    const repository = {
      claimDue: vi.fn<OutboxRepository["claimDue"]>().mockResolvedValue([claimed]),
      complete: vi.fn<OutboxRepository["complete"]>().mockResolvedValue(undefined),
      fail: vi.fn<OutboxRepository["fail"]>(),
    } satisfies OutboxRepository;
    const close = vi.fn().mockResolvedValue(undefined);
    const openRepository = vi.fn(() => ({ repository, close }));
    const publish = vi.fn().mockResolvedValue(undefined);
    const composed = composeOutboxDispatcher(config, {
      openRepository,
      publisher: { publish },
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    await expect(composed.dispatcher.runTick()).resolves.toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 0,
    });
    await composed.close();

    expect(openRepository).toHaveBeenCalledWith({
      databaseUrl: config.databaseUrl,
      poolMax: 3,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: claimed.eventId }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed when no real publisher is configured", async () => {
    const repository = {
      claimDue: vi.fn<OutboxRepository["claimDue"]>().mockResolvedValue([claimed]),
      complete: vi.fn<OutboxRepository["complete"]>(),
      fail: vi.fn<OutboxRepository["fail"]>().mockResolvedValue(undefined),
    } satisfies OutboxRepository;
    const composed = composeOutboxDispatcher(config, {
      openRepository: () => ({ repository, close: () => Promise.resolve() }),
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    await expect(composed.dispatcher.runTick()).resolves.toEqual({
      claimed: 1,
      published: 0,
      retried: 1,
      dead: 0,
      acknowledgementFailed: 0,
    });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: claimed.eventId,
        failureCode: "OUTBOX_PUBLISH_FAILED",
      }),
    );
  });
});
