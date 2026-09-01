import { performance } from "node:perf_hooks";

import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const workloads = [
  ["api", "DATABASE_URL", "app_runtime_login", "app_runtime"],
  ["monitoring-worker", "WORKER_DATABASE_URL", "app_worker_login", "app_worker"],
  ["outbox-dispatcher", "DISPATCHER_DATABASE_URL", "app_dispatcher_login", "app_dispatcher"],
  ["document-worker", "DOCUMENT_WORKER_DATABASE_URL", "app_document_worker_login", "app_document_worker"],
  ["tenant-lifecycle-worker", "TENANT_LIFECYCLE_DATABASE_URL", "app_lifecycle_worker_login", "app_lifecycle_worker"],
];

const results = [];
for (const [workload, environmentName, login, groupRole] of workloads) {
  const pool = new pg.Pool({
    application_name: `meu-processo-${workload}-bounded-smoke`,
    connectionString: required(environmentName),
    connectionTimeoutMillis: 12_000,
    idleTimeoutMillis: 10_000,
    max: 5,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
  });
  const latencies = [];
  const operations = Array.from({ length: 25 }, async () => {
    const startedAt = performance.now();
    const result = await pool.query(
      `select
         current_user = $1 as expected_login,
         pg_has_role(current_user, $2, 'usage') as inherits_role,
         not has_schema_privilege(current_user, 'app_private', 'create')
           as cannot_create`,
      [login, groupRole],
    );
    latencies.push(performance.now() - startedAt);
    const row = result.rows[0];
    if (!row.expected_login || !row.inherits_role || !row.cannot_create) {
      throw new Error("Runtime workload privilege guard failed");
    }
  });
  const settled = await Promise.allSettled(operations);
  await pool.end();
  const errors = settled.filter(({ status }) => status === "rejected").length;
  if (errors !== 0 || latencies.length !== 25) {
    throw new Error(`Bounded runtime smoke failed for ${workload}`);
  }
  latencies.sort((left, right) => left - right);
  results.push({
    errors,
    maxConnections: 5,
    operations: latencies.length,
    p95Milliseconds: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    workload,
  });
}

console.log(JSON.stringify(results));
