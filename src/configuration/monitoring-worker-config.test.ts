import { describe, expect, it } from "vitest";

import {
  MonitoringWorkerRuntimeConfigurationError,
  readMonitoringWorkerRuntimeConfig,
} from "./monitoring-worker-config.js";

const validEnvironment = {
  WORKER_DATABASE_URL:
    "postgresql://worker:password@database.internal:5432/meu_processo?sslmode=require",
  IDENTIFIER_ACTIVE_KEY_VERSION: "v2",
  IDENTIFIER_ENCRYPTION_KEYS_JSON:
    '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE","v2":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"}',
  IDENTIFIER_BLIND_INDEX_VERSION: "v1",
  IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
    "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
} as const;

describe("monitoring worker runtime configuration", () => {
  it("parses bounded defaults and identifier keys", () => {
    expect(readMonitoringWorkerRuntimeConfig(validEnvironment)).toEqual({
      databaseUrl: validEnvironment.WORKER_DATABASE_URL,
      poolMax: 5,
      encryption: {
        activeKeyVersion: "v2",
        encryptionKeys: new Map([
          ["v1", Buffer.alloc(32, 1)],
          ["v2", Buffer.alloc(32, 2)],
        ]),
        blindIndexVersion: "v1",
        blindIndexKey: Buffer.alloc(32, 3),
      },
      worker: {
        workerId: "monitoring-worker",
        batchSize: 10,
        leaseDurationMs: 60_000,
        successIntervalMs: 86_400_000,
        baseBackoffMs: 300_000,
        maxBackoffMs: 86_400_000,
        maxFailures: 5,
      },
    });
  });

  it("accepts explicit safe worker bounds", () => {
    expect(
      readMonitoringWorkerRuntimeConfig({
        ...validEnvironment,
        WORKER_DATABASE_POOL_MAX: "20",
        WORKER_ID: "worker.br-1",
        WORKER_BATCH_SIZE: "25",
        WORKER_LEASE_DURATION_MS: "900000",
        WORKER_SUCCESS_INTERVAL_MS: "300000",
        WORKER_BASE_BACKOFF_MS: "300000",
        WORKER_MAX_BACKOFF_MS: "604800000",
        WORKER_MAX_FAILURES: "20",
      }),
    ).toMatchObject({
      poolMax: 20,
      worker: {
        workerId: "worker.br-1",
        batchSize: 25,
        leaseDurationMs: 900_000,
        successIntervalMs: 300_000,
        baseBackoffMs: 300_000,
        maxBackoffMs: 604_800_000,
        maxFailures: 20,
      },
    });
  });

  it.each([
    [{}, "WORKER_DATABASE_URL"],
    [{ ...validEnvironment, WORKER_DATABASE_URL: "mysql://x:y@host/db" }, "WORKER_DATABASE_URL"],
    [{ ...validEnvironment, WORKER_ID: "contains spaces" }, "WORKER_ID"],
    [{ ...validEnvironment, WORKER_DATABASE_POOL_MAX: "21" }, "WORKER_DATABASE_POOL_MAX"],
    [{ ...validEnvironment, WORKER_BATCH_SIZE: "0" }, "WORKER_BATCH_SIZE"],
    [{ ...validEnvironment, WORKER_LEASE_DURATION_MS: "29999" }, "WORKER_LEASE_DURATION_MS"],
    [{ ...validEnvironment, WORKER_SUCCESS_INTERVAL_MS: "299999" }, "WORKER_SUCCESS_INTERVAL_MS"],
    [{ ...validEnvironment, WORKER_BASE_BACKOFF_MS: "604800001" }, "WORKER_BASE_BACKOFF_MS"],
    [{ ...validEnvironment, WORKER_MAX_BACKOFF_MS: "299999" }, "WORKER_MAX_BACKOFF_MS"],
    [{ ...validEnvironment, WORKER_MAX_FAILURES: "21" }, "WORKER_MAX_FAILURES"],
    [{ ...validEnvironment, IDENTIFIER_ACTIVE_KEY_VERSION: "latest" }, "IDENTIFIER_ACTIVE_KEY_VERSION"],
    [{ ...validEnvironment, IDENTIFIER_ENCRYPTION_KEYS_JSON: "{}" }, "IDENTIFIER_ENCRYPTION_KEYS_JSON"],
    [{ ...validEnvironment, IDENTIFIER_BLIND_INDEX_KEY_BASE64URL: "short" }, "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL"],
  ])("rejects invalid input at %s", (environment, field) => {
    expect(() => readMonitoringWorkerRuntimeConfig(environment)).toThrow(
      new MonitoringWorkerRuntimeConfigurationError(field),
    );
  });
});
