import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  OutboxDeliveryConflictError,
  OutboxDeliveryValidationError,
} from "../application/outbox-dispatcher.js";
import { PostgresOutboxRepository } from "./postgres-outbox-repository.js";

const adminConnectionString = process.env.DATABASE_ADMIN_URL;
const dispatcherConnectionString = process.env.DISPATCHER_DATABASE_URL;
if (!adminConnectionString || !dispatcherConnectionString) {
  throw new Error(
    "DATABASE_ADMIN_URL and DISPATCHER_DATABASE_URL are required for outbox tests.",
  );
}

const adminPool = new Pool({ connectionString: adminConnectionString, max: 1 });
const dispatcherPool = new Pool({
  connectionString: dispatcherConnectionString,
  max: 4,
});
let tokenSequence = 0;
const repository = new PostgresOutboxRepository(
  dispatcherPool,
  () => `postgres-outbox-lease-token-${++tokenSequence}`,
);

const TENANT_ID = "10000000-0000-7000-8000-000000000091";
const USER_ID = "00000000-0000-7000-8000-000000000091";
const EVENT_A = "90000000-0000-7000-8000-000000000091";
const EVENT_B = "90000000-0000-7000-8000-000000000092";
const EVENT_C = "90000000-0000-7000-8000-000000000093";

const insertEvent = async (
  eventId: string,
  availableAt: string,
): Promise<void> => {
  await adminPool.query(
    `insert into app_private.outbox_events (
       event_id, tenant_id, event_type, aggregate_type, aggregate_id,
       correlation_id, payload, available_at
     ) values (
       $1::uuid, $2::uuid, 'monitoring.completed.v1', 'monitoring_target',
       '20000000-0000-7000-8000-000000000091',
       '30000000-0000-7000-8000-000000000091',
       '{"count":1,"nested":{"safe":true}}'::jsonb, $3::timestamptz
     )`,
    [eventId, TENANT_ID, availableAt],
  );
};

beforeAll(async () => {
  const client = await adminPool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into app_private.user_accounts (user_id, provider_subject)
       values ($1::uuid, 'provider-outbox-repository-synthetic')`,
      [USER_ID],
    );
    await client.query(
      `insert into app_private.tenants (
         tenant_id, tenant_kind, personal_owner_user_id
       ) values ($1::uuid, 'personal', $2::uuid)`,
      [TENANT_ID, USER_ID],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await dispatcherPool.end();
  await adminPool.end();
});

describe("PostgresOutboxRepository", () => {
  it("claims concurrently once and completes idempotently", async () => {
    await insertEvent(EVENT_A, "2001-01-01T00:00:00Z");
    const input = {
      workerId: "dispatcher-contract",
      now: new Date("2001-01-01T00:00:00Z"),
      limit: 1,
      leaseDurationMs: 60_000,
    };
    const [left, right] = await Promise.all([
      repository.claimDue(input),
      repository.claimDue(input),
    ]);
    const claims = [...left, ...right];
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      eventId: EVENT_A,
      tenantId: TENANT_ID,
      eventType: "monitoring.completed.v1",
      aggregateType: "monitoring_target",
      aggregateId: "20000000-0000-7000-8000-000000000091",
      correlationId: "30000000-0000-7000-8000-000000000091",
      payload: { count: 1, nested: { safe: true } },
      attemptCount: 1,
    });

    const command = {
      eventId: EVENT_A,
      leaseToken: claims[0]!.leaseToken,
      completedAt: new Date("2001-01-01T00:00:30Z"),
    };
    await expect(repository.complete(command)).resolves.toBeUndefined();
    await expect(repository.complete(command)).resolves.toBeUndefined();
    await expect(repository.complete({
      ...command,
      leaseToken: "postgres-outbox-lease-token-wrong",
    })).rejects.toBeInstanceOf(OutboxDeliveryConflictError);

    const state = await adminPool.query<{
      status: string;
      attempt_count: number;
      lease_token_hash: Buffer | null;
    }>(
      `select status, attempt_count, lease_token_hash
         from app_private.outbox_events where event_id = $1::uuid`,
      [EVENT_A],
    );
    expect(state.rows[0]).toEqual({
      status: "published",
      attempt_count: 1,
      lease_token_hash: null,
    });
  });

  it("reclaims, retries and terminates the same event safely", async () => {
    await insertEvent(EVENT_B, "2001-02-01T00:00:00Z");
    const first = (await repository.claimDue({
      workerId: "dispatcher-first",
      now: new Date("2001-02-01T00:00:00Z"),
      limit: 1,
      leaseDurationMs: 30_000,
    }))[0]!;
    expect(await repository.claimDue({
      workerId: "dispatcher-early",
      now: new Date("2001-02-01T00:00:29Z"),
      limit: 1,
      leaseDurationMs: 30_000,
    })).toEqual([]);
    const second = (await repository.claimDue({
      workerId: "dispatcher-reclaim",
      now: new Date("2001-02-01T00:00:31Z"),
      limit: 1,
      leaseDurationMs: 30_000,
    }))[0]!;
    expect(second).toMatchObject({ eventId: EVENT_B, attemptCount: 2 });
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(repository.complete({
      eventId: EVENT_B,
      leaseToken: first.leaseToken,
      completedAt: new Date("2001-02-01T00:00:31Z"),
    })).rejects.toBeInstanceOf(OutboxDeliveryConflictError);

    const retry = {
      eventId: EVENT_B,
      leaseToken: second.leaseToken,
      failedAt: new Date("2001-02-01T00:00:40Z"),
      failureCode: "OUTBOX_PUBLISH_FAILED",
      nextAttemptAt: new Date("2001-02-01T00:01:40Z"),
      terminal: false,
    };
    await expect(repository.fail(retry)).resolves.toBeUndefined();
    await expect(repository.fail(retry)).resolves.toBeUndefined();
    expect(await repository.claimDue({
      workerId: "dispatcher-too-early",
      now: new Date("2001-02-01T00:01:39Z"),
      limit: 1,
      leaseDurationMs: 30_000,
    })).toEqual([]);

    const third = (await repository.claimDue({
      workerId: "dispatcher-terminal",
      now: new Date("2001-02-01T00:01:40Z"),
      limit: 1,
      leaseDurationMs: 30_000,
    }))[0]!;
    expect(third).toMatchObject({ eventId: EVENT_B, attemptCount: 3 });
    await expect(repository.fail(retry)).rejects.toBeInstanceOf(
      OutboxDeliveryConflictError,
    );
    const terminal = {
      eventId: EVENT_B,
      leaseToken: third.leaseToken,
      failedAt: new Date("2001-02-01T00:01:50Z"),
      failureCode: "OUTBOX_PUBLISH_FAILED",
      nextAttemptAt: null,
      terminal: true,
    } as const;
    await expect(repository.fail(terminal)).resolves.toBeUndefined();
    await expect(repository.fail(terminal)).resolves.toBeUndefined();

    const state = await adminPool.query<{
      status: string;
      attempt_count: number;
      last_failure_code: string;
    }>(
      `select status, attempt_count, last_failure_code
         from app_private.outbox_events where event_id = $1::uuid`,
      [EVENT_B],
    );
    expect(state.rows[0]).toEqual({
      status: "dead",
      attempt_count: 3,
      last_failure_code: "OUTBOX_PUBLISH_FAILED",
    });
  });

  it("rejects invalid input, future work and direct table access", async () => {
    await insertEvent(EVENT_C, "2003-01-01T00:00:00Z");
    await expect(repository.claimDue({
      workerId: "invalid worker",
      now: new Date("2002-01-01T00:00:00Z"),
      limit: 1,
      leaseDurationMs: 60_000,
    })).rejects.toBeInstanceOf(OutboxDeliveryValidationError);
    await expect(repository.claimDue({
      workerId: "dispatcher-valid",
      now: new Date("2002-01-01T00:00:00Z"),
      limit: 1,
      leaseDurationMs: 60_000,
    })).resolves.toEqual([]);
    await expect(
      dispatcherPool.query("select * from app_private.outbox_events"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      dispatcherPool.query(
        "insert into app_private.consumer_inbox_receipts values ('x', null, null, null, now())",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
