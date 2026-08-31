import { describe, expect, it } from "vitest";

import {
  OutboxDispatcherRuntimeConfigurationError,
  readOutboxDispatcherRuntimeConfig,
} from "./outbox-dispatcher-config.js";

const validEnvironment = {
  DISPATCHER_DATABASE_URL:
    "postgresql://dispatcher:password@database.internal:5432/meu_processo?sslmode=require",
} as const;

describe("outbox dispatcher runtime configuration", () => {
  it("parses bounded defaults", () => {
    expect(readOutboxDispatcherRuntimeConfig(validEnvironment)).toEqual({
      databaseUrl: validEnvironment.DISPATCHER_DATABASE_URL,
      poolMax: 5,
      dispatcher: {
        workerId: "outbox-dispatcher",
        batchSize: 10,
        leaseDurationMs: 60_000,
        baseBackoffMs: 60_000,
        maxBackoffMs: 3_600_000,
        maxAttempts: 5,
      },
    });
  });

  it("accepts explicit safe bounds", () => {
    expect(
      readOutboxDispatcherRuntimeConfig({
        ...validEnvironment,
        DISPATCHER_DATABASE_POOL_MAX: "20",
        DISPATCHER_ID: "dispatcher.br-1",
        DISPATCHER_BATCH_SIZE: "25",
        DISPATCHER_LEASE_DURATION_MS: "900000",
        DISPATCHER_BASE_BACKOFF_MS: "60000",
        DISPATCHER_MAX_BACKOFF_MS: "86400000",
        DISPATCHER_MAX_ATTEMPTS: "20",
      }),
    ).toEqual({
      databaseUrl: validEnvironment.DISPATCHER_DATABASE_URL,
      poolMax: 20,
      dispatcher: {
        workerId: "dispatcher.br-1",
        batchSize: 25,
        leaseDurationMs: 900_000,
        baseBackoffMs: 60_000,
        maxBackoffMs: 86_400_000,
        maxAttempts: 20,
      },
    });
  });

  it.each([
    [{}, "DISPATCHER_DATABASE_URL"],
    [
      { ...validEnvironment, DISPATCHER_DATABASE_URL: "mysql://x:y@host/db" },
      "DISPATCHER_DATABASE_URL",
    ],
    [
      {
        ...validEnvironment,
        DISPATCHER_DATABASE_URL:
          "postgresql://x:y@host/db?sslmode=disable",
      },
      "DISPATCHER_DATABASE_URL",
    ],
    [{ ...validEnvironment, DISPATCHER_ID: "contains spaces" }, "DISPATCHER_ID"],
    [
      { ...validEnvironment, DISPATCHER_DATABASE_POOL_MAX: "21" },
      "DISPATCHER_DATABASE_POOL_MAX",
    ],
    [{ ...validEnvironment, DISPATCHER_BATCH_SIZE: "0" }, "DISPATCHER_BATCH_SIZE"],
    [
      { ...validEnvironment, DISPATCHER_LEASE_DURATION_MS: "29999" },
      "DISPATCHER_LEASE_DURATION_MS",
    ],
    [
      { ...validEnvironment, DISPATCHER_BASE_BACKOFF_MS: "59999" },
      "DISPATCHER_BASE_BACKOFF_MS",
    ],
    [
      { ...validEnvironment, DISPATCHER_MAX_BACKOFF_MS: "86400001" },
      "DISPATCHER_MAX_BACKOFF_MS",
    ],
    [
      {
        ...validEnvironment,
        DISPATCHER_BASE_BACKOFF_MS: "120000",
        DISPATCHER_MAX_BACKOFF_MS: "60000",
      },
      "DISPATCHER_MAX_BACKOFF_MS",
    ],
    [
      { ...validEnvironment, DISPATCHER_MAX_ATTEMPTS: "21" },
      "DISPATCHER_MAX_ATTEMPTS",
    ],
  ])("rejects invalid input at %s", (environment, field) => {
    expect(() => readOutboxDispatcherRuntimeConfig(environment)).toThrow(
      new OutboxDispatcherRuntimeConfigurationError(field),
    );
  });
});
