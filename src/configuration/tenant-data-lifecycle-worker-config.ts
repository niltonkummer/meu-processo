import { isAbsolute, relative, resolve } from "node:path";

import type { TenantDataLifecycleWorkerConfig } from
  "../application/tenant-data-lifecycle-worker.js";
import { isValidGcsBucketName } from "./gcs-bucket.js";

type Environment = Readonly<Record<string, string | undefined>>;

export type TenantDataLifecycleWorkerRuntimeConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "local";
      readonly databaseUrl: string;
      readonly poolMax: number;
      readonly objectRoot: string;
      readonly encryption: {
        readonly activeKeyVersion: string;
        readonly encryptionKeys: ReadonlyMap<string, Uint8Array>;
        readonly blindIndexVersion: string;
        readonly blindIndexKey: Uint8Array;
      };
      readonly worker: TenantDataLifecycleWorkerConfig;
    }
  | {
      readonly mode: "gcs";
      readonly databaseUrl: string;
      readonly poolMax: number;
      readonly bucketName: string;
      readonly encryption: {
        readonly activeKeyVersion: string;
        readonly encryptionKeys: ReadonlyMap<string, Uint8Array>;
        readonly blindIndexVersion: string;
        readonly blindIndexKey: Uint8Array;
      };
      readonly worker: TenantDataLifecycleWorkerConfig;
    };

export class TenantDataLifecycleWorkerRuntimeConfigurationError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = "TenantDataLifecycleWorkerRuntimeConfigurationError";
  }
}

const RELATED_FIELDS = [
  "TENANT_LIFECYCLE_DATABASE_URL", "TENANT_LIFECYCLE_DATABASE_POOL_MAX",
  "TENANT_LIFECYCLE_OBJECT_ROOT", "TENANT_LIFECYCLE_GCS_BUCKET",
  "TENANT_LIFECYCLE_WORKER_ID",
  "TENANT_LIFECYCLE_BATCH_SIZE", "TENANT_LIFECYCLE_LEASE_DURATION_MS",
  "TENANT_LIFECYCLE_BASE_BACKOFF_MS", "TENANT_LIFECYCLE_MAX_BACKOFF_MS",
  "TENANT_LIFECYCLE_MAX_ATTEMPTS", "TENANT_LIFECYCLE_MAX_EXPORT_BYTES",
  "TENANT_LIFECYCLE_EXPIRATION_BATCH_SIZE", "IDENTIFIER_ACTIVE_KEY_VERSION",
  "IDENTIFIER_ENCRYPTION_KEYS_JSON", "IDENTIFIER_BLIND_INDEX_VERSION",
  "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL",
] as const;
const VERSION = /^v[1-9]\d*$/;
const WORKER = /^[A-Za-z0-9._:-]{1,100}$/;

const fail = (field: string): never => {
  throw new TenantDataLifecycleWorkerRuntimeConfigurationError(field);
};
const required = (environment: Environment, field: string): string =>
  environment[field] || fail(field);
const integer = (
  environment: Environment,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const value = Number(environment[field] ?? String(fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(field);
  return value;
};

const databaseUrl = (environment: Environment): string => {
  const field = "TENANT_LIFECYCLE_DATABASE_URL";
  const raw = required(environment, field);
  try {
    const url = new URL(raw);
    const sslModes = url.searchParams.getAll("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname ||
      !url.username || !url.password || url.pathname.length < 2 || url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      sslModes.length > 1 || (sslModes.length === 1 &&
        !["require", "verify-ca", "verify-full"].includes(sslModes[0]!))
    ) fail(field);
    return raw;
  } catch (error) {
    if (error instanceof TenantDataLifecycleWorkerRuntimeConfigurationError) {
      throw error;
    }
    return fail(field);
  }
};

const version = (environment: Environment, field: string): string => {
  const value = required(environment, field);
  if (!VERSION.test(value)) fail(field);
  return value;
};
const key = (field: string, value: unknown): Buffer => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) fail(field);
  const encoded = String(value);
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded) {
    fail(field);
  }
  return decoded;
};
const keys = (environment: Environment): ReadonlyMap<string, Uint8Array> => {
  const field = "IDENTIFIER_ENCRYPTION_KEYS_JSON";
  try {
    const parsed: unknown = JSON.parse(required(environment, field));
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    ) fail(field);
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 8 ||
        entries.some(([entryVersion]) => !VERSION.test(entryVersion))) fail(field);
    return new Map(entries.map(([entryVersion, value]) =>
      [entryVersion, key(field, value)]));
  } catch (error) {
    if (error instanceof TenantDataLifecycleWorkerRuntimeConfigurationError) {
      throw error;
    }
    return fail(field);
  }
};
const objectRoot = (environment: Environment): string => {
  const field = "TENANT_LIFECYCLE_OBJECT_ROOT";
  const raw = required(environment, field);
  if (!isAbsolute(raw)) fail(field);
  const absolute = resolve(raw);
  const webRoot = resolve("dist/web");
  const relation = relative(webRoot, absolute);
  if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
    fail(field);
  }
  return absolute;
};

export const readTenantDataLifecycleWorkerRuntimeConfig = (
  environment: Environment,
): TenantDataLifecycleWorkerRuntimeConfig => {
  const mode = environment.TENANT_LIFECYCLE_MODE ?? "disabled";
  if (mode === "disabled") {
    if (RELATED_FIELDS.some((field) => Boolean(environment[field]))) {
      fail("TENANT_LIFECYCLE_MODE");
    }
    return { mode };
  }
  if (mode !== "local" && mode !== "gcs") fail("TENANT_LIFECYCLE_MODE");
  const workerId = environment.TENANT_LIFECYCLE_WORKER_ID ??
    "tenant-lifecycle-worker";
  if (!WORKER.test(workerId)) fail("TENANT_LIFECYCLE_WORKER_ID");
  const baseBackoffMs = integer(
    environment, "TENANT_LIFECYCLE_BASE_BACKOFF_MS", 60_000, 60_000, 86_400_000,
  );
  const maxBackoffMs = integer(
    environment, "TENANT_LIFECYCLE_MAX_BACKOFF_MS", 3_600_000,
    60_000, 86_400_000,
  );
  if (maxBackoffMs < baseBackoffMs) fail("TENANT_LIFECYCLE_MAX_BACKOFF_MS");
  const activeKeyVersion = version(environment, "IDENTIFIER_ACTIVE_KEY_VERSION");
  const encryptionKeys = keys(environment);
  if (!encryptionKeys.has(activeKeyVersion)) fail("IDENTIFIER_ACTIVE_KEY_VERSION");

  const common = {
    databaseUrl: databaseUrl(environment),
    poolMax: integer(
      environment, "TENANT_LIFECYCLE_DATABASE_POOL_MAX", 5, 1, 20,
    ),
    encryption: {
      activeKeyVersion,
      encryptionKeys,
      blindIndexVersion: version(environment, "IDENTIFIER_BLIND_INDEX_VERSION"),
      blindIndexKey: key(
        "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL",
        required(environment, "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL"),
      ),
    },
    worker: {
      workerId,
      batchSize: integer(
        environment, "TENANT_LIFECYCLE_BATCH_SIZE", 10, 1, 10,
      ),
      leaseDurationMs: integer(
        environment, "TENANT_LIFECYCLE_LEASE_DURATION_MS", 60_000,
        30_000, 900_000,
      ),
      baseBackoffMs,
      maxBackoffMs,
      maxAttempts: integer(
        environment, "TENANT_LIFECYCLE_MAX_ATTEMPTS", 3, 1, 3,
      ),
      maximumExportBytes: integer(
        environment, "TENANT_LIFECYCLE_MAX_EXPORT_BYTES", 10 * 1024 * 1024,
        1, 10 * 1024 * 1024,
      ),
      expirationBatchSize: integer(
        environment, "TENANT_LIFECYCLE_EXPIRATION_BATCH_SIZE", 10, 1, 10,
      ),
    },
  };
  if (mode === "gcs") {
    if (environment.TENANT_LIFECYCLE_OBJECT_ROOT) {
      fail("TENANT_LIFECYCLE_OBJECT_ROOT");
    }
    const bucketName = required(environment, "TENANT_LIFECYCLE_GCS_BUCKET");
    if (!isValidGcsBucketName(bucketName)) {
      fail("TENANT_LIFECYCLE_GCS_BUCKET");
    }
    return {
      mode: "gcs",
      bucketName,
      ...common,
    };
  }
  if (environment.TENANT_LIFECYCLE_GCS_BUCKET) {
    fail("TENANT_LIFECYCLE_GCS_BUCKET");
  }
  return { mode: "local", objectRoot: objectRoot(environment), ...common };
};
