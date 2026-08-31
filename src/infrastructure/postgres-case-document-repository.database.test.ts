import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CaseDocumentPageValidationError } from "../application/persisted-case-documents.js";
import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import { PostgresCaseDocumentRepository } from "./postgres-case-document-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!adminUrl || !runtimeUrl) throw new Error("Database URLs are required for document contracts.");
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
const repository = new PostgresCaseDocumentRepository(runtime);

const USER = "00000000-0000-7000-8000-000000000931";
const TENANT = "10000000-0000-7000-8000-000000000931";
const FOREIGN_USER = "00000000-0000-7000-8000-000000000932";
const FOREIGN_TENANT = "10000000-0000-7000-8000-000000000932";
const CASE = "83000000-0000-7000-8000-000000000931";
const EVENT = "86000000-0000-7000-8000-000000000931";
const SOURCE = "40000000-0000-7000-8000-000000009999";
const ENVELOPE = "81000000-0000-7000-8000-000000000931";
const DOCUMENT_1 = "88000000-0000-7000-8000-000000000931";
const DOCUMENT_2 = "88000000-0000-7000-8000-000000000932";
const ARTIFACT = "89000000-0000-7000-8000-000000000931";

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("begin");
    for (const [user, tenant, provider] of [[USER, TENANT, "document-user"], [FOREIGN_USER, FOREIGN_TENANT, "document-foreign"]]) {
      await client.query("insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)", [user, provider]);
      await client.query("insert into app_private.tenants(tenant_id,tenant_kind,personal_owner_user_id) values($1,'personal',$2)", [tenant, user]);
      await client.query("insert into app_private.tenant_members(tenant_id,user_id,membership_role) values($1,$2,'owner')", [tenant, user]);
    }
    await client.query(`insert into app_private.case_records(
      tenant_id,case_id,cnj_normalized,tribunal_code,first_seen_at,last_projected_at
    ) values($1,$2,'0000001-23.2026.8.99.0931','TJZZ','2026-08-31T08:00Z','2026-08-31T11:00Z')`, [TENANT, CASE]);
    await client.query("insert into app_private.tenant_cases(tenant_id,tenant_case_id,case_id,granted_at) values($1,'85000000-0000-7000-8000-000000000931',$2,'2026-08-31T11:00Z')", [TENANT, CASE]);
    await client.query(`insert into app_private.source_envelopes(
      tenant_id,envelope_id,source_id,external_id,content_hash,retrieved_at
    ) values($1,$2,$3,'document-envelope',$4,'2026-08-31T11:00Z')`, [TENANT, ENVELOPE, SOURCE, `sha256:${"e".repeat(64)}`]);
    await client.query(`insert into app_private.case_events(
      tenant_id,case_event_id,case_id,source_id,event_type,external_event_key,
      occurred_at,title,content_hash,schema_version,projected_at
    ) values($1,$2,$3,$4,'publication','document-publication','2026-08-31T09:30Z',
      'Publicação com documento',$5,1,'2026-08-31T11:00Z')`,
    [TENANT, EVENT, CASE, SOURCE, `sha256:${"f".repeat(64)}`]);
    for (const [id, suffix, created, event] of [
      [DOCUMENT_1, "1", "2026-08-31T09:00Z", null],
      [DOCUMENT_2, "2", "2026-08-31T10:00Z", EVENT],
    ] as const) {
      await client.query(`insert into app_private.document_records(
        tenant_id,document_id,case_id,case_event_id,source_id,envelope_id,
        external_document_id,document_type,title,access_class,
        availability_status,source_created_at,last_verified_at
      ) values($1,$2,$3,$4,$5,$6,$7,'intimacao',$8,'public_official',
        $9,$10,'2026-08-31T11:00Z')`,
      [TENANT, id, CASE, event, SOURCE, ENVELOPE, `external-${suffix}`,
        `Intimação ${suffix}`, suffix === "2" ? "available" : "metadata_only", created]);
    }
    await client.query(`insert into app_private.document_artifacts(
      tenant_id,artifact_id,document_id,scope_kind,storage_object_id,
      content_hash,media_type,size_bytes,malware_scan_status,
      encryption_key_version,created_at,expires_at
    ) values($1,$2,$3,'tenant_private',$4,$5,'application/pdf',2048,'clean','v1',
      statement_timestamp(),statement_timestamp() + interval '1 day')`,
    [TENANT, ARTIFACT, DOCUMENT_2,
      `documents/tenant/${TENANT}/${DOCUMENT_2}/${ARTIFACT}.pdf`,
      `sha256:${"a".repeat(64)}`]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
});

afterAll(async () => { await Promise.all([admin.end(), runtime.end()]); });

describe("PostgresCaseDocumentRepository", () => {
  it("paginates safe metadata and returns only a valid clean artifact", async () => {
    const context = { userId: USER, tenantId: TENANT };
    const first = await repository.list(context, CASE, { limit: 1 });
    expect(first.items[0]).toMatchObject({
      documentId: DOCUMENT_2,
      caseEventId: EVENT,
      title: "Intimação 2",
      source: { sourceId: "synthetic-worker", official: false },
      artifact: {
        artifactId: ARTIFACT,
        mediaType: "application/pdf",
        sizeBytes: 2048,
        sha256: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(first.next).toEqual({
      sourceCreatedAt: new Date("2026-08-31T10:00:00.000Z"),
      documentId: DOCUMENT_2,
    });
    const second = await repository.list(context, CASE, { limit: 1, after: first.next! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ documentId: DOCUMENT_1, artifact: null });
    expect(second.next).toBeNull();
  });

  it("hides absent and foreign cases", async () => {
    await expect(repository.list(
      { userId: FOREIGN_USER, tenantId: FOREIGN_TENANT }, CASE, { limit: 20 },
    )).resolves.toEqual({ caseFound: false, items: [], next: null });
  });

  it("rejects invalid pages, membership and direct table access", async () => {
    await expect(repository.list({ userId: USER, tenantId: TENANT }, "bad", { limit: 20 }))
      .rejects.toBeInstanceOf(CaseDocumentPageValidationError);
    await expect(repository.list({ userId: USER, tenantId: TENANT }, CASE, {
      limit: 20,
      after: { sourceCreatedAt: new Date("bad"), documentId: DOCUMENT_1 },
    })).rejects.toBeInstanceOf(CaseDocumentPageValidationError);
    await expect(repository.list({ userId: FOREIGN_USER, tenantId: TENANT }, CASE, { limit: 20 }))
      .rejects.toBeInstanceOf(RepositoryAccessDeniedError);
    await expect(runtime.query("select storage_object_id from app_private.document_artifacts"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(admin.query(`insert into app_private.document_artifacts(
      tenant_id,artifact_id,document_id,scope_kind,storage_object_id,
      content_hash,media_type,size_bytes,malware_scan_status,
      encryption_key_version,expires_at
    ) values($1,'89000000-0000-7000-8000-000000000999',$2,'tenant_private',$3,
      $4,'application/pdf',100,'clean','v1',statement_timestamp()+interval '1 day')`,
    [FOREIGN_TENANT, DOCUMENT_2,
      `documents/tenant/${FOREIGN_TENANT}/${DOCUMENT_2}/89000000-0000-7000-8000-000000000999.pdf`,
      `sha256:${"b".repeat(64)}`]))
      .rejects.toMatchObject({ code: "23503" });
  });
});
