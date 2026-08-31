import { isAbsolute, relative, resolve } from "node:path";

import type { DocumentMaterializationWorkerConfig } from
  "../application/document-materialization-worker.js";
import { isValidGcsBucketName } from "./gcs-bucket.js";

type Environment = Readonly<Record<string, string | undefined>>;

export type DocumentMaterializationRuntimeConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "local-fixture";
      readonly databaseUrl: string;
      readonly poolMax: number;
      readonly fixtureRoot: string;
      readonly objectRoot: string;
      readonly sourceCode: string;
      readonly worker: DocumentMaterializationWorkerConfig;
    }
  | {
      readonly mode: "gcs-fixture";
      readonly databaseUrl: string;
      readonly poolMax: number;
      readonly fixtureRoot: string;
      readonly bucketName: string;
      readonly sourceCode: string;
      readonly worker: DocumentMaterializationWorkerConfig;
    };

export class DocumentMaterializationRuntimeConfigurationError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = "DocumentMaterializationRuntimeConfigurationError";
  }
}

const RELATED_FIELDS = [
  "DOCUMENT_WORKER_DATABASE_URL",
  "DOCUMENT_WORKER_DATABASE_POOL_MAX",
  "DOCUMENT_WORKER_ID",
  "DOCUMENT_WORKER_BATCH_SIZE",
  "DOCUMENT_WORKER_LEASE_DURATION_MS",
  "DOCUMENT_WORKER_BASE_BACKOFF_MS",
  "DOCUMENT_WORKER_MAX_BACKOFF_MS",
  "DOCUMENT_WORKER_MAX_ATTEMPTS",
  "DOCUMENT_MAX_BYTES",
  "DOCUMENT_ARTIFACT_TTL_MS",
  "DOCUMENT_FIXTURE_ROOT",
  "DOCUMENT_MATERIALIZATION_ROOT",
  "DOCUMENT_MATERIALIZATION_BUCKET",
  "DOCUMENT_FIXTURE_SOURCE_CODE",
] as const;

const fail = (field: string): never => {
  throw new DocumentMaterializationRuntimeConfigurationError(field);
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
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(field);
  return value;
};

const readDatabaseUrl = (environment: Environment): string => {
  const field = "DOCUMENT_WORKER_DATABASE_URL";
  const raw = required(environment, field);
  try {
    const url = new URL(raw);
    const sslModes = url.searchParams.getAll("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password || url.pathname.length < 2 ||
      url.hash || [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      sslModes.length > 1 ||
      (sslModes.length === 1 &&
        !["require", "verify-ca", "verify-full"].includes(sslModes[0]!))
    ) fail(field);
    return raw;
  } catch (error) {
    if (error instanceof DocumentMaterializationRuntimeConfigurationError) throw error;
    return fail(field);
  }
};

const within = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

const readRoot = (
  environment: Environment,
  field: string,
): string => {
  const raw = required(environment, field);
  if (!isAbsolute(raw)) fail(field);
  const absolute = resolve(raw);
  const webRoot = resolve("dist/web");
  if (within(webRoot, absolute)) fail(field);
  return absolute;
};

export const readDocumentMaterializationRuntimeConfig = (
  environment: Environment,
): DocumentMaterializationRuntimeConfig => {
  const mode = environment.DOCUMENT_MATERIALIZATION_MODE ?? "disabled";
  if (mode === "disabled") {
    if (RELATED_FIELDS.some((field) => Boolean(environment[field]))) {
      fail("DOCUMENT_MATERIALIZATION_MODE");
    }
    return { mode };
  }
  if (mode !== "local-fixture" && mode !== "gcs-fixture") {
    fail("DOCUMENT_MATERIALIZATION_MODE");
  }

  const workerId = environment.DOCUMENT_WORKER_ID ??
    "document-materialization-worker";
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(workerId)) fail("DOCUMENT_WORKER_ID");
  const sourceCode = environment.DOCUMENT_FIXTURE_SOURCE_CODE ?? "synthetic-worker";
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(sourceCode)) {
    fail("DOCUMENT_FIXTURE_SOURCE_CODE");
  }
  const baseBackoffMs = readInteger(
    environment, "DOCUMENT_WORKER_BASE_BACKOFF_MS", 60_000, 60_000, 86_400_000,
  );
  const maxBackoffMs = readInteger(
    environment, "DOCUMENT_WORKER_MAX_BACKOFF_MS", 3_600_000, 60_000, 86_400_000,
  );
  if (maxBackoffMs < baseBackoffMs) fail("DOCUMENT_WORKER_MAX_BACKOFF_MS");
  const fixtureRoot = readRoot(environment, "DOCUMENT_FIXTURE_ROOT");
  const common = {
    databaseUrl: readDatabaseUrl(environment),
    poolMax: readInteger(
      environment, "DOCUMENT_WORKER_DATABASE_POOL_MAX", 5, 1, 20,
    ),
    fixtureRoot,
    sourceCode,
    worker: {
      workerId,
      batchSize: readInteger(
        environment, "DOCUMENT_WORKER_BATCH_SIZE", 10, 1, 10,
      ),
      leaseDurationMs: readInteger(
        environment, "DOCUMENT_WORKER_LEASE_DURATION_MS", 60_000, 30_000, 900_000,
      ),
      baseBackoffMs,
      maxBackoffMs,
      maxAttempts: readInteger(
        environment, "DOCUMENT_WORKER_MAX_ATTEMPTS", 5, 1, 20,
      ),
      maximumBytes: readInteger(
        environment, "DOCUMENT_MAX_BYTES", 25 * 1024 * 1024,
        1, 25 * 1024 * 1024,
      ),
      artifactTtlMs: readInteger(
        environment, "DOCUMENT_ARTIFACT_TTL_MS", 86_400_000,
        3_600_000, 604_800_000,
      ),
    },
  };
  if (mode === "gcs-fixture") {
    if (environment.DOCUMENT_MATERIALIZATION_ROOT) {
      fail("DOCUMENT_MATERIALIZATION_ROOT");
    }
    const bucketName = required(
      environment, "DOCUMENT_MATERIALIZATION_BUCKET",
    );
    if (!isValidGcsBucketName(bucketName)) {
      fail("DOCUMENT_MATERIALIZATION_BUCKET");
    }
    return {
      mode: "gcs-fixture",
      bucketName,
      ...common,
    };
  }
  if (environment.DOCUMENT_MATERIALIZATION_BUCKET) {
    fail("DOCUMENT_MATERIALIZATION_BUCKET");
  }
  const objectRoot = readRoot(environment, "DOCUMENT_MATERIALIZATION_ROOT");
  if (within(fixtureRoot, objectRoot) || within(objectRoot, fixtureRoot)) {
    fail("DOCUMENT_MATERIALIZATION_ROOT");
  }
  return { mode: "local-fixture", objectRoot, ...common };
};
