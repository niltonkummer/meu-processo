import { createHash, randomBytes } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import {
  type ClaimedOutboxEvent,
  type JsonValue,
  OutboxDeliveryConflictError,
  OutboxDeliveryValidationError,
  type OutboxRepository,
} from "../application/outbox-dispatcher.js";

interface ClaimRow extends QueryResultRow {
  event_id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  payload: unknown;
  attempt_count: number;
}

interface AcceptedRow extends QueryResultRow {
  accepted: boolean;
}

type QueryablePool = Pick<Pool, "query">;

export class OutboxProjectionError extends Error {
  constructor() {
    super("Outbox event projection is invalid.");
    this.name = "OutboxProjectionError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const EVENT_TYPE = /^[a-z][a-z0-9.]{2,99}\.v[1-9][0-9]*$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();
const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const parseJsonValue = (value: unknown, depth: number): JsonValue => {
  if (depth > 8) throw new OutboxProjectionError();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item) => parseJsonValue(item, depth + 1));
  }
  if (typeof value !== "object") throw new OutboxProjectionError();
  const entries = Object.entries(value);
  if (entries.length > 100) throw new OutboxProjectionError();
  return Object.fromEntries(
    entries.map(([key, item]) => [key, parseJsonValue(item, depth + 1)]),
  );
};

const parsePayload = (value: unknown): Readonly<Record<string, JsonValue>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OutboxProjectionError();
  }
  const parsed = parseJsonValue(value, 0);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Buffer.byteLength(JSON.stringify(parsed), "utf8") > 4096
  ) {
    throw new OutboxProjectionError();
  }
  return parsed as Readonly<Record<string, JsonValue>>;
};

const parseClaim = (row: ClaimRow, leaseToken: string): ClaimedOutboxEvent => {
  if (
    !UUID.test(row.event_id) ||
    !UUID.test(row.tenant_id) ||
    !EVENT_TYPE.test(row.event_type) ||
    row.aggregate_type.length < 2 ||
    row.aggregate_type.length > 64 ||
    !UUID.test(row.aggregate_id) ||
    !UUID.test(row.correlation_id) ||
    !Number.isInteger(row.attempt_count) ||
    row.attempt_count < 1 ||
    row.attempt_count > 1000
  ) {
    throw new OutboxProjectionError();
  }
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    correlationId: row.correlation_id,
    payload: parsePayload(row.payload),
    attemptCount: row.attempt_count,
    leaseToken,
  };
};

const mapDatabaseError = (error: unknown): Error => {
  if (
    error instanceof OutboxDeliveryConflictError ||
    error instanceof OutboxDeliveryValidationError ||
    error instanceof OutboxProjectionError
  ) {
    return error;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "22023") return new OutboxDeliveryValidationError();
  if (code && ["23503", "23505", "23514", "42501"].includes(code)) {
    return new OutboxDeliveryConflictError();
  }
  return error instanceof Error
    ? error
    : new Error("Outbox database operation failed.");
};

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(
    private readonly pool: QueryablePool,
    private readonly createLeaseToken: () => string = () =>
      randomBytes(32).toString("base64url"),
  ) {}

  async claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    if (
      !WORKER_ID.test(input.workerId) ||
      !validDate(input.now) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 25 ||
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 30_000 ||
      input.leaseDurationMs > 900_000
    ) {
      throw new OutboxDeliveryValidationError();
    }
    const claims: ClaimedOutboxEvent[] = [];
    try {
      for (let index = 0; index < input.limit; index += 1) {
        const leaseToken = this.createLeaseToken();
        if (leaseToken.length < 16) throw new OutboxDeliveryValidationError();
        const result = await this.pool.query<ClaimRow>(
          `select event_id, tenant_id, event_type, aggregate_type, aggregate_id,
                  correlation_id, payload, attempt_count
             from app_private.claim_outbox_event(
               $1, $2::timestamptz, $3::timestamptz, $4::bytea
             )`,
          [
            input.workerId,
            input.now,
            new Date(input.now.getTime() + input.leaseDurationMs),
            digest(leaseToken),
          ],
        );
        const row = result.rows[0];
        if (!row) break;
        claims.push(parseClaim(row, leaseToken));
      }
      return claims;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async complete(input: {
    readonly eventId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
  }): Promise<void> {
    if (
      !UUID.test(input.eventId) ||
      input.leaseToken.length < 16 ||
      !validDate(input.completedAt)
    ) {
      throw new OutboxDeliveryValidationError();
    }
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.complete_outbox_event(
           $1::uuid, $2::bytea, $3::timestamptz
         ) as accepted`,
        [input.eventId, digest(input.leaseToken), input.completedAt],
      );
      if (result.rows[0]?.accepted !== true) {
        throw new OutboxDeliveryConflictError();
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async fail(input: {
    readonly eventId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void> {
    if (
      !UUID.test(input.eventId) ||
      input.leaseToken.length < 16 ||
      !validDate(input.failedAt) ||
      !FAILURE_CODE.test(input.failureCode) ||
      (input.terminal && input.nextAttemptAt !== null) ||
      (!input.terminal &&
        (input.nextAttemptAt === null ||
          !validDate(input.nextAttemptAt) ||
          input.nextAttemptAt.getTime() < input.failedAt.getTime() + 60_000 ||
          input.nextAttemptAt.getTime() >
            input.failedAt.getTime() + 86_400_000))
    ) {
      throw new OutboxDeliveryValidationError();
    }
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.fail_outbox_event(
           $1::uuid, $2::bytea, $3::timestamptz, $4, $5::timestamptz,
           $6::boolean
         ) as accepted`,
        [
          input.eventId,
          digest(input.leaseToken),
          input.failedAt,
          input.failureCode,
          input.nextAttemptAt,
          input.terminal,
        ],
      );
      if (result.rows[0]?.accepted !== true) {
        throw new OutboxDeliveryConflictError();
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
