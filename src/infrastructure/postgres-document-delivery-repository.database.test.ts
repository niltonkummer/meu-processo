import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import { PostgresDocumentDeliveryRepository } from "./postgres-document-delivery-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!adminUrl || !runtimeUrl) throw new Error("Database URLs are required for delivery contracts.");
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 4 });
const repository = new PostgresDocumentDeliveryRepository(runtime);

const USER = "00000000-0000-7000-8000-000000000971";
const TENANT = "10000000-0000-7000-8000-000000000971";
const FOREIGN_USER = "00000000-0000-7000-8000-000000000972";
const FOREIGN_TENANT = "10000000-0000-7000-8000-000000000972";
const CASE = "83000000-0000-7000-8000-000000000971";
const DOCUMENT = "88000000-0000-7000-8000-000000000971";
const RESTRICTED_DOCUMENT = "88000000-0000-7000-8000-000000000972";
const ARTIFACT = "89000000-0000-7000-8000-000000000971";
const RESTRICTED_ARTIFACT = "89000000-0000-7000-8000-000000000972";
const SOURCE = "40000000-0000-7000-8000-000000009999";
const ENVELOPE = "81000000-0000-7000-8000-000000000971";

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("begin");
    for (const [user, tenant, provider] of [
      [USER, TENANT, "delivery-user"],
      [FOREIGN_USER, FOREIGN_TENANT, "delivery-foreign"],
    ]) {
      await client.query(
        "insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)",
        [user, provider],
      );
      await client.query(
        "insert into app_private.tenants(tenant_id,tenant_kind,personal_owner_user_id) values($1,'personal',$2)",
        [tenant, user],
      );
      await client.query(
        "insert into app_private.tenant_members(tenant_id,user_id,membership_role) values($1,$2,'owner')",
        [tenant, user],
      );
    }
    await client.query(`insert into app_private.case_records(
      tenant_id,case_id,cnj_normalized,tribunal_code,first_seen_at,last_projected_at
    ) values($1,$2,'0000001-23.2026.8.99.0971','TJZZ',
      '2026-08-31T08:00Z','2026-08-31T12:00Z')`, [TENANT, CASE]);
    await client.query(`insert into app_private.tenant_cases(
      tenant_id,tenant_case_id,case_id,granted_at
    ) values($1,'85000000-0000-7000-8000-000000000971',$2,'2026-08-31T12:00Z')`,
    [TENANT, CASE]);
    await client.query(`insert into app_private.source_envelopes(
      tenant_id,envelope_id,source_id,external_id,content_hash,retrieved_at
    ) values($1,$2,$3,'delivery-envelope',$4,'2026-08-31T12:00Z')`,
    [TENANT, ENVELOPE, SOURCE, `sha256:${"e".repeat(64)}`]);
    for (const [document, artifact, access, suffix] of [
      [DOCUMENT, ARTIFACT, "public_official", "public"],
      [RESTRICTED_DOCUMENT, RESTRICTED_ARTIFACT, "restricted", "restricted"],
    ]) {
      await client.query(`insert into app_private.document_records(
        tenant_id,document_id,case_id,source_id,envelope_id,
        external_document_id,document_type,title,access_class,
        availability_status,source_created_at,last_verified_at
      ) values($1,$2,$3,$4,$5,$6,'decisao',$7,$8,'available',
        '2026-08-31T10:00Z','2026-08-31T12:00Z')`,
      [TENANT, document, CASE, SOURCE, ENVELOPE, `delivery-${suffix}`,
        `Documento ${suffix}`, access]);
      await client.query(`insert into app_private.document_artifacts(
        tenant_id,artifact_id,document_id,scope_kind,storage_object_id,
        content_hash,media_type,size_bytes,malware_scan_status,
        encryption_key_version,expires_at
      ) values($1,$2,$3,'tenant_private',$4,$5,'application/pdf',512,'clean','v1',
        statement_timestamp() + interval '1 day')`,
      [TENANT, artifact, document,
        `documents/tenant/${TENANT}/${document}/${artifact}.pdf`,
        `sha256:${"a".repeat(64)}`]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => { await Promise.all([admin.end(), runtime.end()]); });

describe("PostgresDocumentDeliveryRepository database contract", () => {
  it("enforces a concurrent quota and records one immutable outcome", async () => {
    const context = { userId: USER, tenantId: TENANT };
    const attempts = await Promise.all([1, 2, 3].map((suffix) =>
      repository.authorize(context, {
        caseId: CASE,
        documentId: DOCUMENT,
        authorizationId: `8a000000-0000-7000-8000-00000000097${suffix}`,
        requestId: `8b000000-0000-7000-8000-00000000097${suffix}`,
        quotaPerMinute: 2,
      }),
    ));
    expect(attempts.filter((item) => item.kind === "authorized")).toHaveLength(2);
    expect(attempts.filter((item) => item.kind === "quota_exceeded")).toHaveLength(1);
    const authorized = attempts.find((item) => item.kind === "authorized");
    expect(authorized).toMatchObject({
      authorization: {
        tenantId: TENANT,
        userId: USER,
        caseId: CASE,
        documentId: DOCUMENT,
        artifactId: ARTIFACT,
      },
    });
    const authorizationId = authorized!.authorization.authorizationId;
    await expect(repository.recordOutcome(context, authorizationId, "delivered"))
      .resolves.toBe(true);
    await expect(repository.recordOutcome(context, authorizationId, "storage_failed"))
      .resolves.toBe(false);
    const audit = await admin.query(
      "select outcome from app_private.document_download_outcomes where tenant_id=$1 and authorization_id=$2",
      [TENANT, authorizationId],
    );
    expect(audit.rows).toEqual([{ outcome: "delivered" }]);
  });

  it("hides restricted, absent and foreign documents before consuming quota", async () => {
    const base = {
      authorizationId: "8a000000-0000-7000-8000-000000000979",
      requestId: "8b000000-0000-7000-8000-000000000979",
      quotaPerMinute: 20,
    };
    await expect(repository.authorize(
      { userId: USER, tenantId: TENANT },
      { ...base, caseId: CASE, documentId: RESTRICTED_DOCUMENT },
    )).resolves.toEqual({ kind: "not_found" });
    await expect(repository.authorize(
      { userId: FOREIGN_USER, tenantId: FOREIGN_TENANT },
      { ...base, caseId: CASE, documentId: DOCUMENT },
    )).resolves.toEqual({ kind: "not_found" });
    await expect(repository.authorize(
      { userId: FOREIGN_USER, tenantId: TENANT },
      { ...base, caseId: CASE, documentId: DOCUMENT },
    )).rejects.toBeInstanceOf(RepositoryAccessDeniedError);
  });

  it("denies direct runtime access to quota, authorization and audit", async () => {
    for (const table of [
      "document_download_windows",
      "document_download_authorizations",
      "document_download_outcomes",
    ]) {
      await expect(runtime.query(`select * from app_private.${table}`))
        .rejects.toMatchObject({ code: "42501" });
    }
  });
});
