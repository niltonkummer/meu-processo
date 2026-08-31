import { Pool, type PoolConfig } from "pg";

export type PostgresRuntimeWorkload =
  | "api"
  | "monitoring-worker"
  | "outbox-dispatcher"
  | "document-worker"
  | "tenant-lifecycle-worker";

export interface PostgresRuntimePoolInput {
  readonly connectionString: string;
  readonly max: number;
  readonly workload: PostgresRuntimeWorkload;
}

export class PostgresRuntimePoolConfigurationError extends Error {
  constructor(readonly field: "connectionString" | "max") {
    super(field);
    this.name = "PostgresRuntimePoolConfigurationError";
  }
}

const APPLICATION_NAMES: Readonly<Record<PostgresRuntimeWorkload, string>> = {
  api: "meu-processo-api",
  "monitoring-worker": "meu-processo-monitoring-worker",
  "outbox-dispatcher": "meu-processo-outbox-dispatcher",
  "document-worker": "meu-processo-document-worker",
  "tenant-lifecycle-worker": "meu-processo-tenant-lifecycle-worker",
};

const POOLER_LOGIN_ROLES: Readonly<Record<PostgresRuntimeWorkload, string>> = {
  api: "app_runtime_login",
  "monitoring-worker": "app_worker_login",
  "outbox-dispatcher": "app_dispatcher_login",
  "document-worker": "app_document_worker_login",
  "tenant-lifecycle-worker": "app_lifecycle_worker_login",
};

const poolerEndpoint = (url: URL): boolean =>
  url.hostname.endsWith(".pooler.supabase.com");

const validateConnection = (
  connectionString: string,
  workload: PostgresRuntimeWorkload,
): { readonly transactionPooler: boolean } => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new PostgresRuntimePoolConfigurationError("connectionString");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname || !url.username || !url.password || url.pathname.length < 2
  ) {
    throw new PostgresRuntimePoolConfigurationError("connectionString");
  }
  const transactionPooler = poolerEndpoint(url);
  if (!transactionPooler) return { transactionPooler };

  const sslModes = url.searchParams.getAll("sslmode");
  const expectedUser = `${POOLER_LOGIN_ROLES[workload]}.`;
  if (
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    url.port !== "6543" ||
    !url.username.startsWith(expectedUser) ||
    !new RegExp(`^${expectedUser.replace(".", "\\.")}[a-z0-9]{20}$`).test(
      url.username,
    ) ||
    sslModes.length !== 1 ||
    !["require", "verify-ca", "verify-full"].includes(sslModes[0]!)
  ) {
    throw new PostgresRuntimePoolConfigurationError("connectionString");
  }
  return { transactionPooler };
};

export const postgresRuntimePoolOptions = (
  input: PostgresRuntimePoolInput,
): PoolConfig => {
  if (!Number.isInteger(input.max) || input.max < 1 || input.max > 20) {
    throw new PostgresRuntimePoolConfigurationError("max");
  }
  const { transactionPooler } = validateConnection(
    input.connectionString,
    input.workload,
  );
  if (transactionPooler && input.max > 5) {
    throw new PostgresRuntimePoolConfigurationError("max");
  }

  return {
    connectionString: input.connectionString,
    max: input.max,
    min: 0,
    application_name: APPLICATION_NAMES[input.workload],
    allowExitOnIdle: input.workload !== "api",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: transactionPooler ? 10_000 : 30_000,
    maxLifetimeSeconds: transactionPooler ? 300 : 1_800,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 5_000,
  };
};

export const openPostgresRuntimePool = (
  input: PostgresRuntimePoolInput,
): Pool => {
  const pool = new Pool(postgresRuntimePoolOptions(input));
  // Idle-client errors must not terminate a process or disclose connection data.
  pool.on("error", () => undefined);
  return pool;
};
