import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const projectRef = required("SUPABASE_PROJECT_REF");
const databasePassword = required("SUPABASE_DB_PASSWORD");
const infisicalProjectId = required("INFISICAL_PROJECT_ID");
const infisicalDomain = process.env.INFISICAL_API_URL ??
  "https://eu.infisical.com/api";
const infisicalEnvironment = process.env.INFISICAL_ENVIRONMENT ?? "dev";
const directHost = `db.${projectRef}.supabase.co`;
const poolerHost = "aws-0-sa-east-1.pooler.supabase.com";

const definitions = [
  ["app_runtime_login", "app_runtime", "DATABASE_URL"],
  ["app_worker_login", "app_worker", "WORKER_DATABASE_URL"],
  ["app_dispatcher_login", "app_dispatcher", "DISPATCHER_DATABASE_URL"],
  [
    "app_document_worker_login",
    "app_document_worker",
    "DOCUMENT_WORKER_DATABASE_URL",
  ],
  [
    "app_lifecycle_worker_login",
    "app_lifecycle_worker",
    "TENANT_LIFECYCLE_DATABASE_URL",
  ],
];

const expectedVersions = Array.from(
  { length: 19 },
  (_, index) => String(index + 1).padStart(4, "0"),
);
const passwords = new Map(
  definitions.map(([login]) => [login, randomBytes(32).toString("base64url")]),
);
const loginNames = definitions.map(([login]) => login);

const client = new pg.Client({
  application_name: "meu-processo-runtime-login-provisioner",
  connectionTimeoutMillis: 12_000,
  database: "postgres",
  host: directHost,
  password: databasePassword,
  port: 5432,
  ssl: { rejectUnauthorized: true },
  statement_timeout: 10_000,
  user: "postgres",
});

const removeCreatedLogins = async () => {
  await client.query("begin");
  try {
    for (const [login, group] of [...definitions].reverse()) {
      await client.query(`revoke ${group} from ${login}`).catch(() => undefined);
      await client.query(`drop role if exists ${login}`).catch(() => undefined);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
};

await client.connect();
let created = false;

try {
  const history = await client.query(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  const versions = history.rows.map(({ version }) => version);
  if (versions.join(",") !== expectedVersions.join(",")) {
    throw new Error("Migration history mismatch");
  }

  const existing = await client.query(
    "select rolname from pg_roles where rolname = any($1::text[])",
    [loginNames],
  );
  if (existing.rowCount !== 0) throw new Error("Runtime logins already exist");

  await client.query("begin");
  for (const [login, group] of definitions) {
    await client.query("select set_config($1, $2, true)", [
      "meu_processo.bootstrap_password",
      passwords.get(login),
    ]);
    await client.query(`
      do $provision$
      begin
        execute format(
          'create role ${login} login inherit password %L nosuperuser ' ||
          'nocreatedb nocreaterole noreplication nobypassrls connection limit 5',
          current_setting('meu_processo.bootstrap_password')
        );
      end
      $provision$;
    `);
    await client.query(
      `grant ${group} to ${login} with inherit true, set false`,
    );
    await client.query(`alter role ${login} set search_path = ''`);
    await client.query(`alter role ${login} set statement_timeout = '5s'`);
    await client.query(`alter role ${login} set lock_timeout = '3s'`);
    await client.query(
      `alter role ${login} set idle_in_transaction_session_timeout = '5s'`,
    );
  }
  await client.query("commit");
  created = true;

  const audit = await client.query(
    `
      select
        login.rolname as login,
        login.rolcanlogin,
        login.rolsuper,
        login.rolcreatedb,
        login.rolcreaterole,
        login.rolreplication,
        login.rolbypassrls,
        login.rolconnlimit,
        granted.rolname as granted_role,
        membership.inherit_option,
        membership.set_option
      from pg_auth_members as membership
      join pg_roles as login on login.oid = membership.member
      join pg_roles as granted on granted.oid = membership.roleid
      where login.rolname = any($1::text[])
      order by login.rolname
    `,
    [loginNames],
  );
  const invalid = audit.rows.some((role) =>
    !role.rolcanlogin || role.rolsuper || role.rolcreatedb ||
    role.rolcreaterole || role.rolreplication || role.rolbypassrls ||
    role.rolconnlimit !== 5 || !role.inherit_option || role.set_option
  );
  if (audit.rowCount !== 5 || invalid) {
    throw new Error("Runtime login guardrail failed");
  }

  const secretLines = [];
  for (const [login, , secretName] of definitions) {
    const password = encodeURIComponent(passwords.get(login));
    const url = `postgresql://${login}.${projectRef}:${password}@${poolerHost}` +
      ":6543/postgres?sslmode=verify-full";
    secretLines.push(`${secretName}=${url}`);
    if (login === "app_lifecycle_worker_login") {
      secretLines.push(`LIFECYCLE_WORKER_DATABASE_URL=${url}`);
    }
  }

  const directory = await mkdtemp(join(tmpdir(), "meu-processo-infisical-"));
  const secretFile = join(directory, "runtime-db.env");
  try {
    await writeFile(secretFile, `${secretLines.join("\n")}\n`, { mode: 0o600 });
    const result = spawnSync(
      "infisical",
      [
        "secrets",
        "set",
        "--file",
        secretFile,
        `--domain=${infisicalDomain}`,
        `--projectId=${infisicalProjectId}`,
        `--env=${infisicalEnvironment}`,
        "--path=/",
        "--silent",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) throw new Error("Infisical write failed");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }

  console.log(JSON.stringify({
    loginCount: audit.rowCount,
    migrationCount: history.rowCount,
    secretsStored: secretLines.length,
  }));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  if (created) await removeCreatedLogins();
  throw error;
} finally {
  passwords.clear();
  await client.end();
}
