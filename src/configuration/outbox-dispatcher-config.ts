import type { OutboxDispatcherConfig } from "../application/outbox-dispatcher.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface OutboxDispatcherRuntimeConfig {
  readonly databaseUrl: string;
  readonly poolMax: number;
  readonly dispatcher: OutboxDispatcherConfig;
}

export class OutboxDispatcherRuntimeConfigurationError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = "OutboxDispatcherRuntimeConfigurationError";
  }
}

const WORKER_ID = /^[A-Za-z0-9._:-]{1,100}$/;

const fail = (field: string): never => {
  throw new OutboxDispatcherRuntimeConfigurationError(field);
};

const required = (environment: Environment, field: string): string =>
  environment[field] || fail(field);

const readInteger = (
  environment: Environment,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const value = Number(environment[field] ?? String(fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(field);
  }
  return value;
};

const readDatabaseUrl = (environment: Environment): string => {
  const field = "DISPATCHER_DATABASE_URL";
  const raw = required(environment, field);
  try {
    const url = new URL(raw);
    const sslModes = url.searchParams.getAll("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      sslModes.length > 1 ||
      (sslModes.length === 1 &&
        !["require", "verify-ca", "verify-full"].includes(sslModes[0]!))
    ) {
      fail(field);
    }
  } catch (error) {
    if (error instanceof OutboxDispatcherRuntimeConfigurationError) throw error;
    fail(field);
  }
  return raw;
};

export const readOutboxDispatcherRuntimeConfig = (
  environment: Environment,
): OutboxDispatcherRuntimeConfig => {
  const workerId = environment.DISPATCHER_ID ?? "outbox-dispatcher";
  if (!WORKER_ID.test(workerId)) fail("DISPATCHER_ID");
  const baseBackoffMs = readInteger(
    environment,
    "DISPATCHER_BASE_BACKOFF_MS",
    60_000,
    60_000,
    86_400_000,
  );
  const maxBackoffMs = readInteger(
    environment,
    "DISPATCHER_MAX_BACKOFF_MS",
    3_600_000,
    60_000,
    86_400_000,
  );
  if (maxBackoffMs < baseBackoffMs) fail("DISPATCHER_MAX_BACKOFF_MS");

  return {
    databaseUrl: readDatabaseUrl(environment),
    poolMax: readInteger(
      environment,
      "DISPATCHER_DATABASE_POOL_MAX",
      5,
      1,
      20,
    ),
    dispatcher: {
      workerId,
      batchSize: readInteger(
        environment,
        "DISPATCHER_BATCH_SIZE",
        10,
        1,
        25,
      ),
      leaseDurationMs: readInteger(
        environment,
        "DISPATCHER_LEASE_DURATION_MS",
        60_000,
        30_000,
        900_000,
      ),
      baseBackoffMs,
      maxBackoffMs,
      maxAttempts: readInteger(
        environment,
        "DISPATCHER_MAX_ATTEMPTS",
        5,
        1,
        20,
      ),
    },
  };
};
