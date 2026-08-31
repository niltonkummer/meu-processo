import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { foundationRepositoryContract } from "./foundation-repository.contract-test.js";
import { PostgresFoundationRepository } from "./postgres-foundation-repository.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for PostgreSQL contract tests.");
}

foundationRepositoryContract("postgres", () => {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  return Promise.resolve({
      repository: new PostgresFoundationRepository(pool),
      close: () => pool.end(),
    });
});

describe("postgres transaction-scoped tenant context", () => {
  it("clears tenant settings after both commit and rollback", async () => {
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.current_tenant_id', $1, true)",
        ["10000000-0000-7000-8000-000000000901"],
      );
      await client.query("commit");
      const afterCommit = await client.query<{ cleared: boolean }>(
        "select nullif(current_setting('app.current_tenant_id', true), '') is null as cleared",
      );

      await client.query("begin");
      await client.query(
        "select set_config('app.current_tenant_id', $1, true)",
        ["10000000-0000-7000-8000-000000000902"],
      );
      await client.query("rollback");
      const afterRollback = await client.query<{ cleared: boolean }>(
        "select nullif(current_setting('app.current_tenant_id', true), '') is null as cleared",
      );

      expect(afterCommit.rows[0]?.cleared).toBe(true);
      expect(afterRollback.rows[0]?.cleared).toBe(true);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
