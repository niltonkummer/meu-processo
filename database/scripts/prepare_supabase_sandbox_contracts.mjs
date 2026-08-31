import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const projectRef = required("SUPABASE_PROJECT_REF");
const confirmation = required("ALLOW_SYNTHETIC_SANDBOX_RESET");
const action = required("SANDBOX_CONTRACT_ACTION");
const connectionString = required("DATABASE_ADMIN_URL");
const parsed = new URL(connectionString);

if (confirmation !== projectRef) throw new Error("Sandbox reset not confirmed");
if (!new Set(["prepare", "cleanup"]).has(action)) {
  throw new Error("Invalid SANDBOX_CONTRACT_ACTION");
}
if (
  parsed.hostname !== `db.${projectRef}.supabase.co` ||
  parsed.username !== "postgres" ||
  parsed.pathname !== "/postgres"
) {
  throw new Error("Administrative target does not match the confirmed sandbox");
}

const client = new pg.Client({
  application_name: "meu-processo-sandbox-contract-guard",
  connectionString,
  connectionTimeoutMillis: 12_000,
  ssl: { rejectUnauthorized: true },
  statement_timeout: 10_000,
});

await client.connect();
try {
  const migrationHistory = await client.query(`
    select count(*)::integer as total,
           min(version) as first,
           max(version) as last
      from supabase_migrations.schema_migrations
  `);
  const history = migrationHistory.rows[0];
  if (history?.total !== 19 || history.first !== "0001" || history.last !== "0019") {
    throw new Error("Migration history guard failed");
  }

  const dataGuard = await client.query(`
    select
      (select count(*)::integer from app_private.user_accounts) as users,
      (select count(*)::integer
         from app_private.user_accounts
        where user_id::text not like '00000000-0000-7000-8000-%'
           or provider_subject !~* '^(provider-|document-|timeline-|materialization-|lifecycle-|delivery-|deleted:)') as unknown_users,
      (select count(*)::integer from app_private.tenants) as tenants,
      (select count(*)::integer
         from app_private.tenants
        where tenant_id::text not like '10000000-0000-7000-8000-%')
        as unknown_tenants,
      (select count(*)::integer
         from app_private.sources
        where source_code not in ('djen', 'synthetic-worker')) as unknown_sources
  `);
  const inventory = dataGuard.rows[0];
  if (
    inventory?.unknown_users !== 0 || inventory.unknown_tenants !== 0 ||
    inventory.unknown_sources !== 0
  ) {
    throw new Error(
      `Unrecognized sandbox data; reset refused ` +
      `(users=${inventory?.unknown_users},tenants=${inventory?.unknown_tenants},` +
      `sources=${inventory?.unknown_sources})`,
    );
  }

  await client.query("begin");
  await client.query("truncate table app_private.user_accounts cascade");
  await client.query(
    "delete from app_private.sources where source_code = 'synthetic-worker'",
  );
  if (action === "prepare") {
    await client.query(`
      insert into app_private.sources (
        source_id, source_code, source_name, authority, status,
        terms_version, terms_reviewed_at
      ) values (
        '40000000-0000-7000-8000-000000009999',
        'synthetic-worker',
        'Synthetic sandbox contract source',
        'Meu Processo sandbox contracts',
        'active',
        'sandbox-contract-v1',
        statement_timestamp()
      )
    `);
  }
  await client.query("commit");

  console.log(JSON.stringify({
    action,
    migrationCount: history.total,
    removedSyntheticTenants: inventory.tenants,
    removedSyntheticUsers: inventory.users,
    syntheticSourceReady: action === "prepare",
  }));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
