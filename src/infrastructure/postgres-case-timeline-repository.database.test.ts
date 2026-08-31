import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CaseTimelinePageValidationError } from "../application/persisted-case-timeline.js";
import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import { PostgresCaseTimelineRepository } from "./postgres-case-timeline-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!adminUrl || !runtimeUrl) throw new Error("Database URLs are required for timeline contracts.");
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
const repository = new PostgresCaseTimelineRepository(runtime);

const USER = "00000000-0000-7000-8000-000000000921";
const TENANT = "10000000-0000-7000-8000-000000000921";
const FOREIGN_USER = "00000000-0000-7000-8000-000000000922";
const FOREIGN_TENANT = "10000000-0000-7000-8000-000000000922";
const CASE = "83000000-0000-7000-8000-000000000921";
const SOURCE = "40000000-0000-7000-8000-000000009999";

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("begin");
    for (const [user, tenant, provider] of [[USER, TENANT, "timeline-user"], [FOREIGN_USER, FOREIGN_TENANT, "timeline-foreign"]]) {
      await client.query("insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)", [user, provider]);
      await client.query("insert into app_private.tenants(tenant_id,tenant_kind,personal_owner_user_id) values($1,'personal',$2)", [tenant, user]);
      await client.query("insert into app_private.tenant_members(tenant_id,user_id,membership_role) values($1,$2,'owner')", [tenant, user]);
    }
    await client.query(`insert into app_private.case_records(
      tenant_id,case_id,cnj_normalized,tribunal_code,first_seen_at,last_projected_at
    ) values($1,$2,'0000001-23.2026.8.99.0921','TJZZ','2026-08-31T08:00Z','2026-08-31T10:00Z')`, [TENANT, CASE]);
    await client.query("insert into app_private.tenant_cases(tenant_id,tenant_case_id,case_id,granted_at) values($1,'85000000-0000-7000-8000-000000000921',$2,'2026-08-31T10:00Z')", [TENANT, CASE]);
    for (const [suffix, occurred] of [["1", "2026-08-31T09:00Z"], ["2", "2026-08-31T10:00Z"]] as const) {
      const envelope = `81000000-0000-7000-8000-00000000092${suffix}`;
      const event = `86000000-0000-7000-8000-00000000092${suffix}`;
      await client.query(`insert into app_private.source_envelopes(
        tenant_id,envelope_id,source_id,external_id,content_hash,retrieved_at
      ) values($1,$2,$3,$4,$5,'2026-08-31T11:00Z')`, [TENANT, envelope, SOURCE, `timeline-${suffix}`, `sha256:${suffix.repeat(64)}`]);
      await client.query(`insert into app_private.case_events(
        tenant_id,case_event_id,case_id,source_id,event_type,external_event_key,
        occurred_at,title,plain_text_excerpt,content_hash,schema_version,projected_at
      ) values($1,$2,$3,$4,'publication',$5,$6,$7,$8,$9,1,'2026-08-31T11:00Z')`,
      [TENANT, event, CASE, SOURCE, `publication-${suffix}`, occurred, `Publicação ${suffix}`, `Trecho ${suffix}.`, `sha256:${suffix.repeat(64)}`]);
      await client.query(`insert into app_private.event_evidence(
        tenant_id,event_evidence_id,case_event_id,envelope_id,relation
      ) values($1,$2,$3,$4,'supports')`, [TENANT, `87000000-0000-7000-8000-00000000092${suffix}`, event, envelope]);
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
});

afterAll(async () => { await Promise.all([admin.end(), runtime.end()]); });

describe("PostgresCaseTimelineRepository", () => {
  it("paginates events in deterministic reverse chronological order", async () => {
    const context = { userId: USER, tenantId: TENANT };
    const first = await repository.list(context, CASE, { limit: 1 });
    expect(first.items[0]).toMatchObject({ caseEventId: "86000000-0000-7000-8000-000000000922", title: "Publicação 2" });
    expect(first.next).toEqual({ occurredAt: new Date("2026-08-31T10:00:00.000Z"), caseEventId: "86000000-0000-7000-8000-000000000922" });
    const second = await repository.list(context, CASE, { limit: 1, after: first.next! });
    expect(second.items.map((item) => item.caseEventId)).toEqual(["86000000-0000-7000-8000-000000000921"]);
    expect(second.next).toBeNull();
    expect(second.items[0]!.sources).toEqual([{ sourceId: "synthetic-worker", official: false, collectedAt: new Date("2026-08-31T11:00:00.000Z") }]);
  });

  it("hides absent and foreign cases", async () => {
    await expect(repository.list({ userId: FOREIGN_USER, tenantId: FOREIGN_TENANT }, CASE, { limit: 20 }))
      .resolves.toEqual({ caseFound: false, items: [], next: null });
  });

  it("rejects invalid pages, membership and direct table access", async () => {
    await expect(repository.list({ userId: USER, tenantId: TENANT }, "bad", { limit: 20 }))
      .rejects.toBeInstanceOf(CaseTimelinePageValidationError);
    await expect(repository.list({ userId: FOREIGN_USER, tenantId: TENANT }, CASE, { limit: 20 }))
      .rejects.toBeInstanceOf(RepositoryAccessDeniedError);
    await expect(runtime.query("select * from app_private.case_events"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
