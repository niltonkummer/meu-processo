import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const workloads = [
  ["api", "DATABASE_URL", "app_runtime"],
  ["monitoring-worker", "WORKER_DATABASE_URL", "app_worker"],
  ["outbox-dispatcher", "DISPATCHER_DATABASE_URL", "app_dispatcher"],
  ["document-worker", "DOCUMENT_WORKER_DATABASE_URL", "app_document_worker"],
  ["tenant-lifecycle-worker", "TENANT_LIFECYCLE_DATABASE_URL", "app_lifecycle_worker"],
];

const results = [];
for (const [workload, environmentName, groupRole] of workloads) {
  const client = new pg.Client({
    application_name: `meu-processo-${workload}-access-audit`,
    connectionString: required(environmentName),
    connectionTimeoutMillis: 12_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
  });
  await client.connect();
  try {
    const audit = await client.query(
      `select
         current_user as login,
         pg_has_role(current_user, $1, 'member') as is_member,
         pg_has_role(current_user, $1, 'usage') as inherits_role,
         has_schema_privilege(current_user, 'app_private', 'usage') as schema_usage`,
      [groupRole],
    );
    const row = audit.rows[0];
    results.push({
      groupRole,
      inheritsRole: row.inherits_role,
      isMember: row.is_member,
      login: row.login,
      schemaUsage: row.schema_usage,
      workload,
    });
  } finally {
    await client.end();
  }
}

let administrativeAcl = null;
let databaseState = null;
if (process.env.DATABASE_ADMIN_URL) {
  const client = new pg.Client({
    application_name: "meu-processo-runtime-acl-audit",
    connectionString: process.env.DATABASE_ADMIN_URL,
    connectionTimeoutMillis: 12_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
  });
  await client.connect();
  try {
    administrativeAcl = (await client.query(`
      select
        has_schema_privilege('app_runtime', 'app_private', 'usage')
          as runtime_schema_usage,
        has_schema_privilege('app_runtime', 'app_public', 'usage')
          as public_schema_usage,
        has_table_privilege(
          'app_runtime',
          'app_private.user_accounts',
          'select'
        ) as runtime_user_accounts_select,
        has_table_privilege(
          'app_runtime',
          'app_private.user_accounts',
          'insert'
        ) as runtime_user_accounts_insert,
        has_function_privilege(
          'app_runtime',
          'app_private.current_user_id()',
          'execute'
        ) as runtime_context_function,
        has_schema_privilege('app_migrator', 'extensions', 'usage')
          as migrator_extensions_usage,
        has_function_privilege(
          'app_migrator',
          'extensions.digest(bytea,text)',
          'execute'
        ) as migrator_digest_execute
    `)).rows[0];
    const tables = await client.query(`
      select tablename
        from pg_tables
       where schemaname = 'app_private'
       order by tablename
    `);
    let applicationRows = 0;
    for (const { tablename } of tables.rows) {
      if (!/^[a-z][a-z0-9_]*$/.test(tablename)) {
        throw new Error("Unexpected application table name");
      }
      const count = await client.query(
        `select count(*)::integer as total from app_private.${tablename}`,
      );
      applicationRows += count.rows[0].total;
    }
    databaseState = (await client.query(`
      select
        $1::integer as application_rows,
        (select count(*)::integer from app_private.sources) as sources,
        (select count(*)::integer from app_private.user_accounts) as users,
        (select count(*)::integer from app_private.tenants) as tenants,
        (select count(*)::integer
           from supabase_migrations.schema_migrations) as migrations,
        (select count(*)::integer
           from pg_tables where schemaname = 'public') as public_tables,
        (select count(*)::integer
           from pg_class as relation
           join pg_namespace as namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'app_private'
            and relation.relkind in ('r', 'p')
            and exists (
              select 1 from pg_attribute as attribute
               where attribute.attrelid = relation.oid
                 and attribute.attname = 'tenant_id'
                 and attribute.attnum > 0
                 and not attribute.attisdropped
            )
            and not (relation.relrowsecurity and relation.relforcerowsecurity)
        ) as unsafe_tenant_tables
    `, [applicationRows])).rows[0];
  } finally {
    await client.end();
  }
}

console.log(JSON.stringify({ administrativeAcl, databaseState, workloads: results }));
