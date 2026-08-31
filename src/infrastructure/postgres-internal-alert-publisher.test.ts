import { describe, expect, it, vi } from "vitest";

import { PostgresInternalAlertPublisher } from "./postgres-internal-alert-publisher.js";

const event = {
  eventId: "90000000-0000-7000-8000-000000000801",
  tenantId: "10000000-0000-7000-8000-000000000801",
  eventType: "monitoring.execution.completed.v1",
  aggregateType: "monitoring_execution",
  aggregateId: "80000000-0000-7000-8000-000000000801",
  correlationId: "80000000-0000-7000-8000-000000000801",
  payload: { executionId: "80000000-0000-7000-8000-000000000801", observationCount: 1 },
  idempotencyKey: "90000000-0000-7000-8000-000000000801",
};

describe("PostgresInternalAlertPublisher", () => {
  it("projects the exact persisted event through the narrow database function", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ projected_count: 1 }] });
    const publisher = new PostgresInternalAlertPublisher({ query }, () =>
      new Date("2026-08-31T12:00:00.000Z"),
    );
    await publisher.publish(event);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("project_internal_alerts"), [
      event.eventId,
      event.tenantId,
      event.eventType,
      event.aggregateId,
      event.payload,
      new Date("2026-08-31T12:00:00.000Z"),
    ]);
  });

  it("rejects a mismatched idempotency key, invalid clock and database failure", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database details"));
    const publisher = new PostgresInternalAlertPublisher({ query });
    await expect(
      publisher.publish({ ...event, idempotencyKey: event.aggregateId }),
    ).rejects.toThrow("Internal alert projection failed.");
    await expect(publisher.publish(event)).rejects.toThrow(
      "Internal alert projection failed.",
    );
    const invalidClock = new PostgresInternalAlertPublisher(
      { query: vi.fn() },
      () => new Date("invalid"),
    );
    await expect(invalidClock.publish(event)).rejects.toThrow(
      "Internal alert projection failed.",
    );
  });
});

