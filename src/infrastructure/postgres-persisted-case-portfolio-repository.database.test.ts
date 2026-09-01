import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PersistedCasePageValidationError,
} from "../application/persisted-case-portfolio.js";
import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import { PostgresPersistedCasePortfolioRepository } from "./postgres-persisted-case-portfolio-repository.js";

const runtimeConnectionString = process.env.DATABASE_URL;
const adminConnectionString = process.env.DATABASE_ADMIN_URL;
if (!runtimeConnectionString || !adminConnectionString) {
  throw new Error(
    "DATABASE_URL and DATABASE_ADMIN_URL are required for case portfolio tests.",
  );
}

const adminPool = new Pool({ connectionString: adminConnectionString, max: 1 });
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 2 });
const repository = new PostgresPersistedCasePortfolioRepository(runtimePool);

const TENANT_A = "10000000-0000-7000-8000-000000000701";
const USER_A = "00000000-0000-7000-8000-000000000701";
const TENANT_B = "10000000-0000-7000-8000-000000000702";
const USER_B = "00000000-0000-7000-8000-000000000702";
const TENANT_EMPTY = "10000000-0000-7000-8000-000000000703";
const USER_EMPTY = "00000000-0000-7000-8000-000000000703";
const CASE_A1 = "83000000-0000-7000-8000-000000000701";
const CASE_A2 = "83000000-0000-7000-8000-000000000702";
const CASE_B1 = "83000000-0000-7000-8000-000000000703";
const SOURCE_ID = "40000000-0000-7000-8000-000000009999";

beforeAll(async () => {
  const client = await adminPool.connect();
  try {
    await client.query("begin");
    for (const [userId, tenantId, providerSubject] of [
      [USER_A, TENANT_A, "provider-portfolio-a-synthetic"],
      [USER_B, TENANT_B, "provider-portfolio-b-synthetic"],
      [USER_EMPTY, TENANT_EMPTY, "provider-portfolio-empty-synthetic"],
    ]) {
      await client.query(
        `insert into app_private.user_accounts (user_id, provider_subject)
         values ($1::uuid, $2)`,
        [userId, providerSubject],
      );
      await client.query(
        `insert into app_private.tenants (
           tenant_id, tenant_kind, personal_owner_user_id
         ) values ($2::uuid, 'personal', $1::uuid)`,
        [userId, tenantId],
      );
      await client.query(
        `insert into app_private.tenant_members (
           tenant_id, user_id, membership_role
         ) values ($2::uuid, $1::uuid, 'owner')`,
        [userId, tenantId],
      );
    }

    for (const item of [
      {
        tenantId: TENANT_A,
        caseId: CASE_A1,
        tenantCaseId: "85000000-0000-7000-8000-000000000701",
        referenceId: "84000000-0000-7000-8000-000000000701",
        cnj: "0000001-23.2026.8.99.0701",
        projectedAt: "2026-08-31T10:00:00.000Z",
      },
      {
        tenantId: TENANT_A,
        caseId: CASE_A2,
        tenantCaseId: "85000000-0000-7000-8000-000000000702",
        referenceId: "84000000-0000-7000-8000-000000000702",
        cnj: "0000002-23.2026.8.99.0702",
        projectedAt: "2026-08-31T11:00:00.000Z",
      },
      {
        tenantId: TENANT_B,
        caseId: CASE_B1,
        tenantCaseId: "85000000-0000-7000-8000-000000000703",
        referenceId: "84000000-0000-7000-8000-000000000703",
        cnj: "0000001-23.2026.8.99.0701",
        projectedAt: "2026-08-31T12:00:00.000Z",
      },
    ]) {
      await client.query(
        `insert into app_private.case_records (
           tenant_id, case_id, cnj_normalized, tribunal_code,
           first_seen_at, last_projected_at
         ) values ($1::uuid, $2::uuid, $3, 'TJZZ', $4, $4)`,
        [item.tenantId, item.caseId, item.cnj, item.projectedAt],
      );
      await client.query(
        `insert into app_private.case_external_references (
           tenant_id, external_reference_id, case_id, source_id,
           external_case_id, first_seen_at, last_seen_at
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $6)`,
        [
          item.tenantId,
          item.referenceId,
          item.caseId,
          SOURCE_ID,
          item.cnj,
          item.projectedAt,
        ],
      );
      await client.query(
        `insert into app_private.tenant_cases (
           tenant_id, tenant_case_id, case_id, granted_at
         ) values ($1::uuid, $2::uuid, $3::uuid, $4)`,
        [item.tenantId, item.tenantCaseId, item.caseId, item.projectedAt],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await runtimePool.end();
  await adminPool.end();
});

describe("PostgresPersistedCasePortfolioRepository", () => {
  it("paginates active grants and returns minimized source provenance", async () => {
    const context = { userId: USER_A, tenantId: TENANT_A };
    const first = await repository.list(context, { limit: 1 });
    expect(first.nextCursor).toBe(CASE_A1);
    expect(first.items).toEqual([
      {
        tenantId: TENANT_A,
        caseId: CASE_A1,
        cnjNumber: "0000001-23.2026.8.99.0701",
        tribunal: "TJZZ",
        identityStatus: "confirmed",
        lastUpdatedAt: new Date("2026-08-31T10:00:00.000Z"),
        sources: [
          {
            sourceId: "synthetic-worker",
            official: false,
            collectedAt: new Date("2026-08-31T10:00:00.000Z"),
          },
        ],
      },
    ]);

    const second = await repository.list(context, {
      limit: 1,
      afterCaseId: first.nextCursor!,
    });
    expect(second.items.map((item) => item.caseId)).toEqual([CASE_A2]);
    expect(second.nextCursor).toBeNull();
  });

  it("isolates the same CNJ and returns an empty authorized tenant", async () => {
    const foreign = await repository.list(
      { userId: USER_B, tenantId: TENANT_B },
      { limit: 20 },
    );
    expect(foreign.items.map((item) => item.caseId)).toEqual([CASE_B1]);
    expect(foreign.items[0]!.cnjNumber).toBe(
      "0000001-23.2026.8.99.0701",
    );
    await expect(
      repository.list(
        { userId: USER_EMPTY, tenantId: TENANT_EMPTY },
        { limit: 20 },
      ),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("rejects invalid pages, inactive membership and direct evidence access", async () => {
    await expect(
      repository.list(
        { userId: USER_A, tenantId: TENANT_A },
        { limit: 0 },
      ),
    ).rejects.toBeInstanceOf(PersistedCasePageValidationError);
    await expect(
      repository.list(
        { userId: USER_B, tenantId: TENANT_A },
        { limit: 20 },
      ),
    ).rejects.toBeInstanceOf(RepositoryAccessDeniedError);
    await expect(
      runtimePool.query("select count(*) from app_private.case_records"),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
