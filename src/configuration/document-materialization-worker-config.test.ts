import { describe, expect, it } from "vitest";

import {
  DocumentMaterializationRuntimeConfigurationError,
  readDocumentMaterializationRuntimeConfig,
} from "./document-materialization-worker-config.js";

const valid = {
  DOCUMENT_MATERIALIZATION_MODE: "local-fixture",
  DOCUMENT_WORKER_DATABASE_URL:
    "postgresql://worker:password@database.internal:5432/meu_processo?sslmode=require",
  DOCUMENT_FIXTURE_ROOT: "/var/lib/meu-processo/document-fixtures",
  DOCUMENT_MATERIALIZATION_ROOT: "/var/lib/meu-processo/document-objects",
} as const;

describe("document materialization worker runtime configuration", () => {
  it("is disabled by default and rejects stray related configuration", () => {
    expect(readDocumentMaterializationRuntimeConfig({})).toEqual({ mode: "disabled" });
    expect(() => readDocumentMaterializationRuntimeConfig({
      DOCUMENT_WORKER_ID: "stray",
    })).toThrow(new DocumentMaterializationRuntimeConfigurationError(
      "DOCUMENT_MATERIALIZATION_MODE",
    ));
  });

  it("parses local fixture defaults with bounded capacity", () => {
    expect(readDocumentMaterializationRuntimeConfig(valid)).toEqual({
      mode: "local-fixture",
      databaseUrl: valid.DOCUMENT_WORKER_DATABASE_URL,
      poolMax: 5,
      fixtureRoot: valid.DOCUMENT_FIXTURE_ROOT,
      objectRoot: valid.DOCUMENT_MATERIALIZATION_ROOT,
      sourceCode: "synthetic-worker",
      worker: {
        workerId: "document-materialization-worker",
        batchSize: 10,
        leaseDurationMs: 60_000,
        baseBackoffMs: 60_000,
        maxBackoffMs: 3_600_000,
        maxAttempts: 5,
        maximumBytes: 25 * 1024 * 1024,
        artifactTtlMs: 86_400_000,
      },
    });
  });

  it("accepts every safe explicit limit", () => {
    expect(readDocumentMaterializationRuntimeConfig({
      ...valid,
      DOCUMENT_WORKER_DATABASE_POOL_MAX: "20",
      DOCUMENT_WORKER_ID: "document-worker.br-1",
      DOCUMENT_WORKER_BATCH_SIZE: "1",
      DOCUMENT_WORKER_LEASE_DURATION_MS: "900000",
      DOCUMENT_WORKER_BASE_BACKOFF_MS: "86400000",
      DOCUMENT_WORKER_MAX_BACKOFF_MS: "86400000",
      DOCUMENT_WORKER_MAX_ATTEMPTS: "20",
      DOCUMENT_MAX_BYTES: "1",
      DOCUMENT_ARTIFACT_TTL_MS: "604800000",
      DOCUMENT_FIXTURE_SOURCE_CODE: "synthetic-source-2",
    })).toMatchObject({
      poolMax: 20,
      sourceCode: "synthetic-source-2",
      worker: {
        workerId: "document-worker.br-1", batchSize: 1,
        leaseDurationMs: 900_000, baseBackoffMs: 86_400_000,
        maxBackoffMs: 86_400_000, maxAttempts: 20,
        maximumBytes: 1, artifactTtlMs: 604_800_000,
      },
    });
  });

  it("parses fixture collection with a GCS object backend", () => {
    const config = readDocumentMaterializationRuntimeConfig({
      ...valid,
      DOCUMENT_MATERIALIZATION_MODE: "gcs-fixture",
      DOCUMENT_MATERIALIZATION_ROOT: undefined,
      DOCUMENT_MATERIALIZATION_BUCKET: "meu-processo-validation",
    });
    expect(config).toMatchObject({
      mode: "gcs-fixture",
      fixtureRoot: valid.DOCUMENT_FIXTURE_ROOT,
      bucketName: "meu-processo-validation",
      sourceCode: "synthetic-worker",
    });
    expect(config).not.toHaveProperty("objectRoot");
  });

  it.each([
    [{ ...valid, DOCUMENT_MATERIALIZATION_MODE: "cloud" }, "DOCUMENT_MATERIALIZATION_MODE"],
    [{ ...valid, DOCUMENT_MATERIALIZATION_BUCKET: "meu-processo-validation" },
      "DOCUMENT_MATERIALIZATION_BUCKET"],
    [{ ...valid, DOCUMENT_MATERIALIZATION_MODE: "gcs-fixture",
      DOCUMENT_MATERIALIZATION_ROOT: undefined }, "DOCUMENT_MATERIALIZATION_BUCKET"],
    [{ ...valid, DOCUMENT_MATERIALIZATION_MODE: "gcs-fixture",
      DOCUMENT_MATERIALIZATION_ROOT: undefined,
      DOCUMENT_MATERIALIZATION_BUCKET: "gs://bucket" },
      "DOCUMENT_MATERIALIZATION_BUCKET"],
    [{ ...valid, DOCUMENT_WORKER_DATABASE_URL: "mysql://x:y@host/db" }, "DOCUMENT_WORKER_DATABASE_URL"],
    [{ ...valid, DOCUMENT_WORKER_DATABASE_POOL_MAX: "21" }, "DOCUMENT_WORKER_DATABASE_POOL_MAX"],
    [{ ...valid, DOCUMENT_WORKER_ID: "contains spaces" }, "DOCUMENT_WORKER_ID"],
    [{ ...valid, DOCUMENT_WORKER_BATCH_SIZE: "11" }, "DOCUMENT_WORKER_BATCH_SIZE"],
    [{ ...valid, DOCUMENT_WORKER_LEASE_DURATION_MS: "29999" }, "DOCUMENT_WORKER_LEASE_DURATION_MS"],
    [{ ...valid, DOCUMENT_WORKER_BASE_BACKOFF_MS: "59999" }, "DOCUMENT_WORKER_BASE_BACKOFF_MS"],
    [{ ...valid, DOCUMENT_WORKER_MAX_BACKOFF_MS: "59999" }, "DOCUMENT_WORKER_MAX_BACKOFF_MS"],
    [{ ...valid, DOCUMENT_WORKER_MAX_ATTEMPTS: "0" }, "DOCUMENT_WORKER_MAX_ATTEMPTS"],
    [{ ...valid, DOCUMENT_MAX_BYTES: "26214401" }, "DOCUMENT_MAX_BYTES"],
    [{ ...valid, DOCUMENT_ARTIFACT_TTL_MS: "3599999" }, "DOCUMENT_ARTIFACT_TTL_MS"],
    [{ ...valid, DOCUMENT_FIXTURE_SOURCE_CODE: "INVALID/SOURCE" }, "DOCUMENT_FIXTURE_SOURCE_CODE"],
    [{ ...valid, DOCUMENT_FIXTURE_ROOT: "relative" }, "DOCUMENT_FIXTURE_ROOT"],
    [{ ...valid, DOCUMENT_MATERIALIZATION_ROOT: "dist/web/objects" }, "DOCUMENT_MATERIALIZATION_ROOT"],
    [{ ...valid, DOCUMENT_MATERIALIZATION_ROOT: valid.DOCUMENT_FIXTURE_ROOT }, "DOCUMENT_MATERIALIZATION_ROOT"],
    [{ ...valid, DOCUMENT_WORKER_BASE_BACKOFF_MS: "3600000",
      DOCUMENT_WORKER_MAX_BACKOFF_MS: "60000" }, "DOCUMENT_WORKER_MAX_BACKOFF_MS"],
  ])("rejects unsafe input at %s", (environment, field) => {
    expect(() => readDocumentMaterializationRuntimeConfig(environment)).toThrow(
      new DocumentMaterializationRuntimeConfigurationError(field),
    );
  });
});
