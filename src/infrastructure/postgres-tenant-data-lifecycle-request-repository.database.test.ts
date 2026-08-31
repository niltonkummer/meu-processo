import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RepositoryAccessDeniedError } from
  "../application/foundation-repository.js";
import { PostgresTenantDataLifecycleRequestRepository } from
  "./postgres-tenant-data-lifecycle-request-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  throw new Error("Database URLs are required for lifecycle contracts.");
}
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
const USER_A = "00000000-0000-7000-8000-000000000795";
const TENANT_A = "10000000-0000-7000-8000-000000000795";
const USER_B = "00000000-0000-7000-8000-000000000796";
const TENANT_B = "10000000-0000-7000-8000-000000000796";

beforeAll(async () => {
  for (const [user, tenant, provider] of [
    [USER_A, TENANT_A, "lifecycle-contract-alpha"],
    [USER_B, TENANT_B, "lifecycle-contract-beta"],
  ]) {
    await admin.query(
      "insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)",
      [user, provider],
    );
    await admin.query(
      `insert into app_private.tenants(
         tenant_id,tenant_kind,personal_owner_user_id
       ) values($1,'personal',$2)`, [tenant, user],
    );
    await admin.query(
      `insert into app_private.tenant_members(
         tenant_id,user_id,membership_role
       ) values($1,$2,'owner')`, [tenant, user],
    );
  }
});

afterAll(async () => {
  await Promise.all([admin.end(), runtime.end()]);
});

describe("Postgres tenant lifecycle request database contract", () => {
  it("is idempotent, rejects cross-tenant context and freezes only its tenant", async () => {
    const repository = new PostgresTenantDataLifecycleRequestRepository(runtime);
    const requestedAt = new Date();
    const requestId = "20000000-0000-7000-8000-000000000795";
    const first = await repository.requestExport(
      { userId: USER_A, tenantId: TENANT_A }, { requestId, requestedAt },
    );
    const duplicate = await repository.requestExport(
      { userId: USER_A, tenantId: TENANT_A }, { requestId, requestedAt },
    );
    expect(duplicate).toEqual(first);
    await expect(repository.get(
      { userId: USER_A, tenantId: TENANT_A }, requestId,
    )).resolves.toMatchObject({ requestId, requestType: "export", state: "pending" });
    await expect(repository.get(
      { userId: USER_B, tenantId: TENANT_B }, requestId,
    )).resolves.toBeNull();
    await expect(repository.requestExport(
      { userId: USER_A, tenantId: TENANT_B },
      { requestId: "20000000-0000-7000-8000-000000000796", requestedAt },
    )).rejects.toBeInstanceOf(RepositoryAccessDeniedError);

    await expect(repository.requestDeletion(
      { userId: USER_A, tenantId: TENANT_A },
      { requestId: "30000000-0000-7000-8000-000000000795",
        requestedAt: new Date(requestedAt.getTime() + 1), confirmed: true },
    )).resolves.toMatchObject({ requestType: "deletion", state: "pending" });
    const states = await admin.query(
      `select tenant_id,status from app_private.tenants
        where tenant_id in ($1,$2) order by tenant_id`, [TENANT_A, TENANT_B],
    );
    expect(states.rows).toEqual([
      { tenant_id: TENANT_A, status: "deleting" },
      { tenant_id: TENANT_B, status: "active" },
    ]);
  });
});
