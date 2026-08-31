import { describe, expect, it } from "vitest";

import {
  openPostgresRuntimePool,
  PostgresRuntimePoolConfigurationError,
  postgresRuntimePoolOptions,
} from "./postgres-runtime-pool.js";

describe("postgres runtime pool policy", () => {
  it("uses bounded, identified connections for a direct local database", () => {
    expect(postgresRuntimePoolOptions({
      connectionString:
        "postgresql://app_runtime_local:password@postgres:5432/meu_processo",
      max: 4,
      workload: "api",
    })).toEqual({
      connectionString:
        "postgresql://app_runtime_local:password@postgres:5432/meu_processo",
      max: 4,
      min: 0,
      application_name: "meu-processo-api",
      allowExitOnIdle: false,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      maxLifetimeSeconds: 1_800,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      statement_timeout: 5_000,
      query_timeout: 6_000,
      lock_timeout: 3_000,
      idle_in_transaction_session_timeout: 5_000,
    });
  });

  it.each([
    ["monitoring-worker", "meu-processo-monitoring-worker"],
    ["outbox-dispatcher", "meu-processo-outbox-dispatcher"],
    ["document-worker", "meu-processo-document-worker"],
    ["tenant-lifecycle-worker", "meu-processo-tenant-lifecycle-worker"],
  ] as const)("identifies the one-shot %s", (workload, applicationName) => {
    const options = postgresRuntimePoolOptions({
      connectionString: "postgresql://worker:password@postgres/meu_processo",
      max: 2,
      workload,
    });

    expect(options.application_name).toBe(applicationName);
    expect(options.allowExitOnIdle).toBe(true);
  });

  it("uses a short, conservative pool for Supavisor transaction mode", () => {
    const options = postgresRuntimePoolOptions({
      connectionString:
        "postgresql://app_runtime_login.tbfhcvrdkrerhzqjwyyu:encoded-password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      max: 5,
      workload: "api",
    });

    expect(options).toMatchObject({
      max: 5,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      application_name: "meu-processo-api",
    });
  });

  it.each([
    ["monitoring-worker", "app_worker_login"],
    ["outbox-dispatcher", "app_dispatcher_login"],
    ["document-worker", "app_document_worker_login"],
    ["tenant-lifecycle-worker", "app_lifecycle_worker_login"],
  ] as const)("accepts only the restricted login for %s", (workload, login) => {
    const options = postgresRuntimePoolOptions({
      connectionString: `postgresql://${login}.tbfhcvrdkrerhzqjwyyu:password@` +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
      max: 1,
      workload,
    });

    expect(options.maxLifetimeSeconds).toBe(300);
  });

  it.each([
    {
      connectionString:
        "postgresql://postgres.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_runtime_login.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://runtime:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_worker_login.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_runtime_login.short:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_runtime_login.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_runtime_login.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?" +
        "sslmode=require&options=-c%20role%3Dpostgres",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_runtime_login.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?" +
        "sslmode=require#fragment",
      max: 5,
      field: "connectionString",
    },
    {
      connectionString:
        "postgresql://app_runtime_login.tbfhcvrdkrerhzqjwyyu:password@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      max: 6,
      field: "max",
    },
  ] as const)("fails closed for an unsafe pooler configuration", (input) => {
    expect(() => postgresRuntimePoolOptions({
      connectionString: input.connectionString,
      max: input.max,
      workload: "api",
    })).toThrowError(new PostgresRuntimePoolConfigurationError(input.field));
  });

  it.each([
    ["not-a-url", 1, "connectionString"],
    ["mysql://runtime:password@database/app", 1, "connectionString"],
    ["postgresql://runtime@database/app", 1, "connectionString"],
    ["postgresql://runtime:password@database/app", 0, "max"],
    ["postgresql://runtime:password@database/app", 21, "max"],
    ["postgresql://runtime:password@database/app", 1.5, "max"],
  ] as const)("rejects invalid base pool input", (connectionString, max, field) => {
    expect(() => postgresRuntimePoolOptions({
      connectionString,
      max,
      workload: "api",
    })).toThrowError(new PostgresRuntimePoolConfigurationError(field));
  });

  it("opens a lazy pool and closes it without making a connection", async () => {
    const pool = openPostgresRuntimePool({
      connectionString: "postgresql://runtime:password@database/app",
      max: 1,
      workload: "api",
    });

    expect(pool.totalCount).toBe(0);
    expect(pool.emit("error", new Error("synthetic idle client failure"))).toBe(true);
    await expect(pool.end()).resolves.toBeUndefined();
  });
});
