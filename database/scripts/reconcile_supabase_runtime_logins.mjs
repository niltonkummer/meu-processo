import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const definitions = [
  ["app_runtime_login", "app_runtime"],
  ["app_worker_login", "app_worker"],
  ["app_dispatcher_login", "app_dispatcher"],
  ["app_document_worker_login", "app_document_worker"],
  ["app_lifecycle_worker_login", "app_lifecycle_worker"],
];
const loginNames = definitions.map(([login]) => login);
const client = new pg.Client({
  application_name: "meu-processo-runtime-login-reconciler",
  connectionString: required("DATABASE_ADMIN_URL"),
  connectionTimeoutMillis: 12_000,
  ssl: { rejectUnauthorized: true },
  statement_timeout: 10_000,
});

await client.connect();
try {
  const history = await client.query(`
    select count(*)::integer as total, min(version) as first, max(version) as last
      from supabase_migrations.schema_migrations
  `);
  const migration = history.rows[0];
  if (migration?.total !== 19 || migration.first !== "0001" || migration.last !== "0019") {
    throw new Error("Migration history guard failed");
  }

  const roles = await client.query(
    `select
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
     order by login.rolname`,
    [loginNames],
  );
  const expectedMemberships = new Map(
    definitions.map(([login, group]) => [login, group]),
  );
  const unsafe = roles.rows.some((role) =>
    !role.rolcanlogin || role.rolsuper || role.rolcreatedb ||
    role.rolcreaterole || role.rolreplication || role.rolbypassrls ||
    role.rolconnlimit !== 5 || !role.inherit_option || role.set_option ||
    expectedMemberships.get(role.login) !== role.granted_role
  );
  if (roles.rowCount !== 5 || unsafe) throw new Error("Runtime role guard failed");

  await client.query("begin");
  for (const [login] of definitions) {
    await client.query(`alter role ${login} set lock_timeout = '3s'`);
  }
  await client.query("commit");

  const settings = await client.query(
    `select count(*)::integer as configured
       from pg_roles
      where rolname = any($1::text[])
        and 'lock_timeout=3s' = any(coalesce(rolconfig, array[]::text[]))`,
    [loginNames],
  );
  if (settings.rows[0]?.configured !== 5) {
    throw new Error("Runtime role timeout reconciliation failed");
  }
  console.log(JSON.stringify({
    lockTimeout: "3s",
    loginCount: roles.rowCount,
    migrationCount: migration.total,
  }));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
