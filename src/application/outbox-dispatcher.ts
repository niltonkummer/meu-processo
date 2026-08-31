export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface OutboxEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
}

export interface ClaimedOutboxEvent extends OutboxEvent {
  readonly attemptCount: number;
  readonly leaseToken: string;
}

export interface OutboxRepository {
  claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedOutboxEvent[]>;
  complete(input: {
    readonly eventId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
  }): Promise<void>;
  fail(input: {
    readonly eventId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void>;
}

export interface OutboxPublisher {
  publish(event: OutboxEvent & { readonly idempotencyKey: string }): Promise<void>;
}

export type OutboxDispatcherMetric =
  | {
      readonly eventId: string;
      readonly eventType: string;
      readonly attemptCount: number;
      readonly outcome: "published";
    }
  | {
      readonly eventId: string;
      readonly eventType: string;
      readonly attemptCount: number;
      readonly outcome: "retry_scheduled" | "dead";
      readonly failureCode: "OUTBOX_PUBLISH_FAILED";
    }
  | {
      readonly eventId: string;
      readonly eventType: string;
      readonly attemptCount: number;
      readonly outcome: "acknowledgement_failed";
    };

export interface OutboxDispatcherConfig {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseDurationMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly maxAttempts: number;
}

export interface OutboxDispatcherSummary {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
  readonly dead: number;
  readonly acknowledgementFailed: number;
}

export class OutboxDispatcherConfigurationError extends Error {
  constructor() {
    super("Outbox dispatcher configuration is invalid.");
    this.name = "OutboxDispatcherConfigurationError";
  }
}

export class OutboxDeliveryConflictError extends Error {
  constructor() {
    super("Outbox delivery state conflict.");
    this.name = "OutboxDeliveryConflictError";
  }
}

export class OutboxDeliveryValidationError extends Error {
  constructor() {
    super("Outbox delivery command is invalid.");
    this.name = "OutboxDeliveryValidationError";
  }
}

const WORKER_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const MIN_LEASE_MS = 30_000;
const MAX_LEASE_MS = 900_000;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 86_400_000;

const integerBetween = (value: number, minimum: number, maximum: number): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

const validConfig = (config: OutboxDispatcherConfig): boolean =>
  WORKER_ID.test(config.workerId) &&
  integerBetween(config.batchSize, 1, 25) &&
  integerBetween(config.leaseDurationMs, MIN_LEASE_MS, MAX_LEASE_MS) &&
  integerBetween(config.baseBackoffMs, MIN_BACKOFF_MS, MAX_BACKOFF_MS) &&
  integerBetween(config.maxBackoffMs, MIN_BACKOFF_MS, MAX_BACKOFF_MS) &&
  config.baseBackoffMs <= config.maxBackoffMs &&
  integerBetween(config.maxAttempts, 1, 20);

const safeMetric = (
  sink: (metric: OutboxDispatcherMetric) => void,
  metric: OutboxDispatcherMetric,
): void => {
  try {
    sink(metric);
  } catch {
    // Telemetry must never change delivery state.
  }
};

export class OutboxDispatcher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: OutboxPublisher,
    private readonly metricSink: (metric: OutboxDispatcherMetric) => void,
    private readonly config: OutboxDispatcherConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!validConfig(config)) throw new OutboxDispatcherConfigurationError();
  }

  async runTick(): Promise<OutboxDispatcherSummary> {
    const now = this.now();
    if (Number.isNaN(now.getTime())) {
      throw new OutboxDispatcherConfigurationError();
    }
    const claimed = await this.repository.claimDue({
      workerId: this.config.workerId,
      now,
      limit: this.config.batchSize,
      leaseDurationMs: this.config.leaseDurationMs,
    });
    const summary = {
      claimed: claimed.length,
      published: 0,
      retried: 0,
      dead: 0,
      acknowledgementFailed: 0,
    };
    for (const item of claimed) {
      await this.process(item, now, summary);
    }
    return summary;
  }

  private async process(
    item: ClaimedOutboxEvent,
    now: Date,
    summary: {
      published: number;
      retried: number;
      dead: number;
      acknowledgementFailed: number;
    },
  ): Promise<void> {
    try {
      await this.publisher.publish({
        eventId: item.eventId,
        tenantId: item.tenantId,
        eventType: item.eventType,
        aggregateType: item.aggregateType,
        aggregateId: item.aggregateId,
        correlationId: item.correlationId,
        payload: item.payload,
        idempotencyKey: item.eventId,
      });
    } catch {
      await this.recordFailure(item, now, summary);
      return;
    }

    try {
      await this.repository.complete({
        eventId: item.eventId,
        leaseToken: item.leaseToken,
        completedAt: now,
      });
      summary.published += 1;
      safeMetric(this.metricSink, {
        eventId: item.eventId,
        eventType: item.eventType,
        attemptCount: item.attemptCount,
        outcome: "published",
      });
    } catch {
      this.recordAcknowledgementFailure(item, summary);
    }
  }

  private async recordFailure(
    item: ClaimedOutboxEvent,
    now: Date,
    summary: {
      retried: number;
      dead: number;
      acknowledgementFailed: number;
    },
  ): Promise<void> {
    const terminal = item.attemptCount >= this.config.maxAttempts;
    const exponent = Math.max(0, item.attemptCount - 1);
    const backoff = Math.min(
      this.config.maxBackoffMs,
      this.config.baseBackoffMs * 2 ** exponent,
    );
    try {
      await this.repository.fail({
        eventId: item.eventId,
        leaseToken: item.leaseToken,
        failedAt: now,
        failureCode: "OUTBOX_PUBLISH_FAILED",
        nextAttemptAt: terminal ? null : new Date(now.getTime() + backoff),
        terminal,
      });
      if (terminal) summary.dead += 1;
      else summary.retried += 1;
      safeMetric(this.metricSink, {
        eventId: item.eventId,
        eventType: item.eventType,
        attemptCount: item.attemptCount,
        outcome: terminal ? "dead" : "retry_scheduled",
        failureCode: "OUTBOX_PUBLISH_FAILED",
      });
    } catch {
      this.recordAcknowledgementFailure(item, summary);
    }
  }

  private recordAcknowledgementFailure(
    item: ClaimedOutboxEvent,
    summary: { acknowledgementFailed: number },
  ): void {
    summary.acknowledgementFailed += 1;
    safeMetric(this.metricSink, {
      eventId: item.eventId,
      eventType: item.eventType,
      attemptCount: item.attemptCount,
      outcome: "acknowledgement_failed",
    });
  }
}
