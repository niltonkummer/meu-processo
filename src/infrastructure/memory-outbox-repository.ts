import {
  type ClaimedOutboxEvent,
  type JsonValue,
  OutboxDeliveryConflictError,
  OutboxDeliveryValidationError,
  type OutboxEvent,
  type OutboxRepository,
} from "../application/outbox-dispatcher.js";

export interface MemoryOutboxSeed extends OutboxEvent {
  readonly availableAt: Date;
}

interface Lease {
  readonly token: string;
  readonly workerId: string;
  readonly until: Date;
}

type Outcome =
  | {
      readonly kind: "complete";
      readonly token: string;
      readonly at: Date;
    }
  | {
      readonly kind: "fail";
      readonly token: string;
      readonly at: Date;
      readonly failureCode: string;
      readonly nextAttemptAt: Date | null;
      readonly terminal: boolean;
    };

interface State {
  readonly event: OutboxEvent;
  status: "pending" | "published" | "dead";
  availableAt: Date;
  attemptCount: number;
  publishedAt: Date | null;
  failureCode: string | null;
  lease: Lease | null;
  lastOutcome: Outcome | null;
}

const WORKER_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

const cloneJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
    );
  }
  return value;
};

const cloneEvent = (event: OutboxEvent): OutboxEvent => ({
  ...event,
  payload: Object.fromEntries(
    Object.entries(event.payload).map(([key, value]) => [key, cloneJson(value)]),
  ),
});

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());
const validToken = (value: string): boolean => value.length >= 16;

export class MemoryOutboxRepository implements OutboxRepository {
  private readonly states = new Map<string, State>();

  constructor(
    seeds: readonly MemoryOutboxSeed[],
    private readonly createLeaseToken: () => string,
  ) {
    for (const seed of seeds) {
      this.states.set(seed.eventId, {
        event: cloneEvent(seed),
        status: "pending",
        availableAt: new Date(seed.availableAt),
        attemptCount: 0,
        publishedAt: null,
        failureCode: null,
        lease: null,
        lastOutcome: null,
      });
    }
  }

  async claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    await Promise.resolve();
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
    const due = [...this.states.values()]
      .filter(
        (state) =>
          state.status === "pending" &&
          state.availableAt.getTime() <= input.now.getTime() &&
          (state.lease === null ||
            state.lease.until.getTime() <= input.now.getTime()),
      )
      .sort(
        (left, right) =>
          left.availableAt.getTime() - right.availableAt.getTime() ||
          left.event.eventId.localeCompare(right.event.eventId),
      )
      .slice(0, input.limit);

    return due.map((state) => {
      const leaseToken = this.createLeaseToken();
      if (!validToken(leaseToken)) throw new OutboxDeliveryValidationError();
      state.lease = {
        token: leaseToken,
        workerId: input.workerId,
        until: new Date(input.now.getTime() + input.leaseDurationMs),
      };
      state.attemptCount += 1;
      state.lastOutcome = null;
      return {
        ...cloneEvent(state.event),
        attemptCount: state.attemptCount,
        leaseToken,
      };
    });
  }

  async complete(input: {
    readonly eventId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
  }): Promise<void> {
    await Promise.resolve();
    if (!validToken(input.leaseToken) || !validDate(input.completedAt)) {
      throw new OutboxDeliveryValidationError();
    }
    const state = this.states.get(input.eventId);
    if (
      state?.lastOutcome?.kind === "complete" &&
      state.lastOutcome.token === input.leaseToken &&
      state.lastOutcome.at.getTime() === input.completedAt.getTime()
    ) {
      return;
    }
    if (
      state?.status !== "pending" ||
      state.lease?.token !== input.leaseToken ||
      input.completedAt.getTime() > state.lease.until.getTime()
    ) {
      throw new OutboxDeliveryConflictError();
    }
    state.status = "published";
    state.publishedAt = new Date(input.completedAt);
    state.failureCode = null;
    state.lease = null;
    state.lastOutcome = {
      kind: "complete",
      token: input.leaseToken,
      at: new Date(input.completedAt),
    };
  }

  async fail(input: {
    readonly eventId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void> {
    await Promise.resolve();
    if (
      !validToken(input.leaseToken) ||
      !validDate(input.failedAt) ||
      !FAILURE_CODE.test(input.failureCode) ||
      (input.terminal && input.nextAttemptAt !== null) ||
      (!input.terminal &&
        (input.nextAttemptAt === null ||
          !validDate(input.nextAttemptAt) ||
          input.nextAttemptAt.getTime() <= input.failedAt.getTime()))
    ) {
      throw new OutboxDeliveryValidationError();
    }
    const state = this.states.get(input.eventId);
    if (
      state?.lastOutcome?.kind === "fail" &&
      state.lastOutcome.token === input.leaseToken &&
      state.lastOutcome.at.getTime() === input.failedAt.getTime() &&
      state.lastOutcome.failureCode === input.failureCode &&
      state.lastOutcome.nextAttemptAt?.getTime() ===
        input.nextAttemptAt?.getTime() &&
      state.lastOutcome.terminal === input.terminal
    ) {
      return;
    }
    if (
      state?.status !== "pending" ||
      state.lease?.token !== input.leaseToken ||
      input.failedAt.getTime() > state.lease.until.getTime()
    ) {
      throw new OutboxDeliveryConflictError();
    }
    state.status = input.terminal ? "dead" : "pending";
    if (input.nextAttemptAt) state.availableAt = new Date(input.nextAttemptAt);
    state.publishedAt = null;
    state.failureCode = input.failureCode;
    state.lease = null;
    state.lastOutcome = {
      kind: "fail",
      token: input.leaseToken,
      at: new Date(input.failedAt),
      failureCode: input.failureCode,
      nextAttemptAt: input.nextAttemptAt
        ? new Date(input.nextAttemptAt)
        : null,
      terminal: input.terminal,
    };
  }

  inspect(eventId: string): {
    readonly status: State["status"];
    readonly attemptCount: number;
    readonly availableAt: Date;
    readonly publishedAt: Date | null;
    readonly failureCode: string | null;
    readonly lease: Lease | null;
  } | null {
    const state = this.states.get(eventId);
    if (!state) return null;
    return {
      status: state.status,
      attemptCount: state.attemptCount,
      availableAt: new Date(state.availableAt),
      publishedAt: state.publishedAt ? new Date(state.publishedAt) : null,
      failureCode: state.failureCode,
      lease: state.lease
        ? {
            ...state.lease,
            until: new Date(state.lease.until),
          }
        : null,
    };
  }
}
