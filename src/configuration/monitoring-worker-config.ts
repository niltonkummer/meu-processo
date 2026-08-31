import type { MonitoringWorkerConfig } from "../application/monitoring-worker.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface MonitoringWorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly poolMax: number;
  readonly encryption: {
    readonly activeKeyVersion: string;
    readonly encryptionKeys: ReadonlyMap<string, Uint8Array>;
    readonly blindIndexVersion: string;
    readonly blindIndexKey: Uint8Array;
  };
  readonly worker: MonitoringWorkerConfig;
}

export class MonitoringWorkerRuntimeConfigurationError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = "MonitoringWorkerRuntimeConfigurationError";
  }
}

const VERSION_PATTERN = /^v[1-9]\d*$/;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

const fail = (field: string): never => {
  throw new MonitoringWorkerRuntimeConfigurationError(field);
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
  const field = "WORKER_DATABASE_URL";
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
    if (error instanceof MonitoringWorkerRuntimeConfigurationError) throw error;
    fail(field);
  }
  return raw;
};

const readVersion = (environment: Environment, field: string): string => {
  const value = required(environment, field);
  if (!VERSION_PATTERN.test(value)) fail(field);
  return value;
};

const readKey = (field: string, value: unknown): Buffer => {
  if (typeof value !== "string") {
    fail(field);
  }
  const encoded = value as string;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail(field);
  const key = Buffer.from(encoded, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== encoded) fail(field);
  return key;
};

const readEncryptionKeys = (
  environment: Environment,
): ReadonlyMap<string, Uint8Array> => {
  const field = "IDENTIFIER_ENCRYPTION_KEYS_JSON";
  try {
    const parsed: unknown = JSON.parse(required(environment, field));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    ) {
      fail(field);
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (
      entries.length < 1 ||
      entries.length > 8 ||
      entries.some(([version]) => !VERSION_PATTERN.test(version))
    ) {
      fail(field);
    }
    return new Map(entries.map(([version, value]) => [version, readKey(field, value)]));
  } catch (error) {
    if (error instanceof MonitoringWorkerRuntimeConfigurationError) throw error;
    return fail(field);
  }
};

export const readMonitoringWorkerRuntimeConfig = (
  environment: Environment,
): MonitoringWorkerRuntimeConfig => {
  const databaseUrl = readDatabaseUrl(environment);
  const activeKeyVersion = readVersion(
    environment,
    "IDENTIFIER_ACTIVE_KEY_VERSION",
  );
  const encryptionKeys = readEncryptionKeys(environment);
  if (!encryptionKeys.has(activeKeyVersion)) {
    fail("IDENTIFIER_ACTIVE_KEY_VERSION");
  }
  const workerId = environment.WORKER_ID ?? "monitoring-worker";
  if (!WORKER_ID_PATTERN.test(workerId)) fail("WORKER_ID");
  const baseBackoffMs = readInteger(
    environment,
    "WORKER_BASE_BACKOFF_MS",
    300_000,
    300_000,
    604_800_000,
  );
  const maxBackoffMs = readInteger(
    environment,
    "WORKER_MAX_BACKOFF_MS",
    86_400_000,
    300_000,
    604_800_000,
  );
  if (maxBackoffMs < baseBackoffMs) fail("WORKER_MAX_BACKOFF_MS");

  return {
    databaseUrl,
    poolMax: readInteger(
      environment,
      "WORKER_DATABASE_POOL_MAX",
      5,
      1,
      20,
    ),
    encryption: {
      activeKeyVersion,
      encryptionKeys,
      blindIndexVersion: readVersion(
        environment,
        "IDENTIFIER_BLIND_INDEX_VERSION",
      ),
      blindIndexKey: readKey(
        "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL",
        required(environment, "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL"),
      ),
    },
    worker: {
      workerId,
      batchSize: readInteger(
        environment,
        "WORKER_BATCH_SIZE",
        10,
        1,
        25,
      ),
      leaseDurationMs: readInteger(
        environment,
        "WORKER_LEASE_DURATION_MS",
        60_000,
        30_000,
        900_000,
      ),
      successIntervalMs: readInteger(
        environment,
        "WORKER_SUCCESS_INTERVAL_MS",
        86_400_000,
        300_000,
        604_800_000,
      ),
      baseBackoffMs,
      maxBackoffMs,
      maxFailures: readInteger(
        environment,
        "WORKER_MAX_FAILURES",
        5,
        1,
        20,
      ),
    },
  };
};
