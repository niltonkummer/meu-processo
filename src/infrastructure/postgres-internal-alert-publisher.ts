import type { Pool } from "pg";

import type { OutboxPublisher } from "../application/outbox-dispatcher.js";

type QueryablePool = Pick<Pool, "query">;

export class InternalAlertProjectionError extends Error {
  constructor() {
    super("Internal alert projection failed.");
    this.name = "InternalAlertProjectionError";
  }
}

export class PostgresInternalAlertPublisher implements OutboxPublisher {
  constructor(
    private readonly pool: QueryablePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(
    event: Parameters<OutboxPublisher["publish"]>[0],
  ): Promise<void> {
    const processedAt = this.now();
    if (
      event.idempotencyKey !== event.eventId ||
      Number.isNaN(processedAt.getTime())
    ) {
      throw new InternalAlertProjectionError();
    }
    try {
      await this.pool.query(
        `select app_private.project_internal_alerts(
           $1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb, $6::timestamptz
         ) as projected_count`,
        [
          event.eventId,
          event.tenantId,
          event.eventType,
          event.aggregateId,
          event.payload,
          processedAt,
        ],
      );
    } catch {
      throw new InternalAlertProjectionError();
    }
  }
}

