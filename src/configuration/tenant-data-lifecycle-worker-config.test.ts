import { describe, expect, it } from "vitest";

import {
  readTenantDataLifecycleWorkerRuntimeConfig,
  TenantDataLifecycleWorkerRuntimeConfigurationError,
} from "./tenant-data-lifecycle-worker-config.js";

const valid = {
  TENANT_LIFECYCLE_MODE: "local",
  TENANT_LIFECYCLE_DATABASE_URL:
    "postgresql://worker:password@database.internal:5432/meu_processo?sslmode=require",
  TENANT_LIFECYCLE_OBJECT_ROOT: "/var/lib/meu-processo/document-objects",
  IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
  IDENTIFIER_ENCRYPTION_KEYS_JSON:
    '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
  IDENTIFIER_BLIND_INDEX_VERSION: "v1",
  IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
    "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
} as const;

describe("tenant data lifecycle worker runtime configuration", () => {
  it("is disabled by default and rejects partial activation", () => {
    expect(readTenantDataLifecycleWorkerRuntimeConfig({})).toEqual({
      mode: "disabled",
    });
    expect(() => readTenantDataLifecycleWorkerRuntimeConfig({
      TENANT_LIFECYCLE_WORKER_ID: "stray",
    })).toThrow(new TenantDataLifecycleWorkerRuntimeConfigurationError(
      "TENANT_LIFECYCLE_MODE",
    ));
  });

  it("parses safe local defaults", () => {
    expect(readTenantDataLifecycleWorkerRuntimeConfig(valid)).toMatchObject({
      mode: "local",
      databaseUrl: valid.TENANT_LIFECYCLE_DATABASE_URL,
      poolMax: 5,
      objectRoot: valid.TENANT_LIFECYCLE_OBJECT_ROOT,
      encryption: { activeKeyVersion: "v1", blindIndexVersion: "v1" },
      worker: {
        workerId: "tenant-lifecycle-worker", batchSize: 10,
        leaseDurationMs: 60_000, baseBackoffMs: 60_000,
        maxBackoffMs: 3_600_000, maxAttempts: 3,
        maximumExportBytes: 10 * 1024 * 1024, expirationBatchSize: 10,
      },
    });
  });

  it("parses the GCS lifecycle backend without a filesystem root", () => {
    const config = readTenantDataLifecycleWorkerRuntimeConfig({
      ...valid,
      TENANT_LIFECYCLE_MODE: "gcs",
      TENANT_LIFECYCLE_OBJECT_ROOT: undefined,
      TENANT_LIFECYCLE_GCS_BUCKET: "meu-processo-validation",
    });
    expect(config).toMatchObject({
      mode: "gcs",
      bucketName: "meu-processo-validation",
      encryption: { activeKeyVersion: "v1" },
    });
    expect(config).not.toHaveProperty("objectRoot");
  });

  it.each([
    [{ ...valid, TENANT_LIFECYCLE_MODE: "cloud" }, "TENANT_LIFECYCLE_MODE"],
    [{ ...valid, TENANT_LIFECYCLE_GCS_BUCKET: "meu-processo-validation" },
      "TENANT_LIFECYCLE_GCS_BUCKET"],
    [{ ...valid, TENANT_LIFECYCLE_MODE: "gcs",
      TENANT_LIFECYCLE_OBJECT_ROOT: undefined }, "TENANT_LIFECYCLE_GCS_BUCKET"],
    [{ ...valid, TENANT_LIFECYCLE_MODE: "gcs",
      TENANT_LIFECYCLE_OBJECT_ROOT: undefined,
      TENANT_LIFECYCLE_GCS_BUCKET: "gs://bucket" },
      "TENANT_LIFECYCLE_GCS_BUCKET"],
    [{ ...valid, TENANT_LIFECYCLE_DATABASE_URL: "mysql://x:y@host/db" },
      "TENANT_LIFECYCLE_DATABASE_URL"],
    [{ ...valid, TENANT_LIFECYCLE_DATABASE_POOL_MAX: "21" },
      "TENANT_LIFECYCLE_DATABASE_POOL_MAX"],
    [{ ...valid, TENANT_LIFECYCLE_OBJECT_ROOT: "relative" },
      "TENANT_LIFECYCLE_OBJECT_ROOT"],
    [{ ...valid, TENANT_LIFECYCLE_OBJECT_ROOT: "dist/web/private" },
      "TENANT_LIFECYCLE_OBJECT_ROOT"],
    [{ ...valid, TENANT_LIFECYCLE_WORKER_ID: "bad worker" },
      "TENANT_LIFECYCLE_WORKER_ID"],
    [{ ...valid, TENANT_LIFECYCLE_BATCH_SIZE: "11" },
      "TENANT_LIFECYCLE_BATCH_SIZE"],
    [{ ...valid, TENANT_LIFECYCLE_LEASE_DURATION_MS: "29999" },
      "TENANT_LIFECYCLE_LEASE_DURATION_MS"],
    [{ ...valid, TENANT_LIFECYCLE_BASE_BACKOFF_MS: "59999" },
      "TENANT_LIFECYCLE_BASE_BACKOFF_MS"],
    [{ ...valid, TENANT_LIFECYCLE_MAX_BACKOFF_MS: "59999" },
      "TENANT_LIFECYCLE_MAX_BACKOFF_MS"],
    [{ ...valid, TENANT_LIFECYCLE_MAX_ATTEMPTS: "4" },
      "TENANT_LIFECYCLE_MAX_ATTEMPTS"],
    [{ ...valid, TENANT_LIFECYCLE_MAX_EXPORT_BYTES: "10485761" },
      "TENANT_LIFECYCLE_MAX_EXPORT_BYTES"],
    [{ ...valid, TENANT_LIFECYCLE_EXPIRATION_BATCH_SIZE: "0" },
      "TENANT_LIFECYCLE_EXPIRATION_BATCH_SIZE"],
    [{ ...valid, IDENTIFIER_ACTIVE_KEY_VERSION: "v2" },
      "IDENTIFIER_ACTIVE_KEY_VERSION"],
    [{ ...valid, IDENTIFIER_ENCRYPTION_KEYS_JSON: "{}" },
      "IDENTIFIER_ENCRYPTION_KEYS_JSON"],
    [{ ...valid, TENANT_LIFECYCLE_BASE_BACKOFF_MS: "3600000",
      TENANT_LIFECYCLE_MAX_BACKOFF_MS: "60000" },
      "TENANT_LIFECYCLE_MAX_BACKOFF_MS"],
  ])("rejects unsafe input at %s", (environment, field) => {
    expect(() => readTenantDataLifecycleWorkerRuntimeConfig(environment)).toThrow(
      new TenantDataLifecycleWorkerRuntimeConfigurationError(field),
    );
  });
});
