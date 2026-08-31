import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TenantDataLifecycleWorker } from
  "../application/tenant-data-lifecycle-worker.js";
import { AesGcmIdentifierProtector } from
  "./aes-gcm-identifier-protector.js";
import { LocalTenantLifecycleObjectStore } from
  "./local-tenant-lifecycle-object-store.js";
import { PostgresTenantDataLifecycleRequestRepository } from
  "./postgres-tenant-data-lifecycle-request-repository.js";
import { PostgresTenantDataLifecycleWorkerRepository } from
  "./postgres-tenant-data-lifecycle-worker-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
const lifecycleUrl = process.env.LIFECYCLE_WORKER_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !lifecycleUrl) {
  throw new Error("Database URLs are required for lifecycle worker contracts.");
}
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
const lifecycle = new Pool({ connectionString: lifecycleUrl, max: 2 });
const SOURCE = "40000000-0000-7000-8000-000000009999";
const A = {
  user: "00000000-0000-7000-8000-000000000851",
  tenant: "10000000-0000-7000-8000-000000000851",
  subject: "20000000-0000-7000-8000-000000000851",
  exportRequest: "30000000-0000-7000-8000-000000000851",
  deletionRequest: "31000000-0000-7000-8000-000000000851",
  exportArtifact: "32000000-0000-8000-8000-000000000851",
  caseId: "83000000-0000-7000-8000-000000000851",
  envelope: "81000000-0000-7000-8000-000000000851",
  document: "88000000-0000-7000-8000-000000000851",
  documentArtifact: "89000000-0000-8000-8000-000000000851",
  name: "Pessoa Sintética Alpha",
};
const B = {
  user: "00000000-0000-7000-8000-000000000852",
  tenant: "10000000-0000-7000-8000-000000000852",
  subject: "20000000-0000-7000-8000-000000000852",
  exportRequest: "30000000-0000-7000-8000-000000000852",
  exportArtifact: "32000000-0000-8000-8000-000000000852",
  caseId: "83000000-0000-7000-8000-000000000852",
  envelope: "81000000-0000-7000-8000-000000000852",
  document: "88000000-0000-7000-8000-000000000852",
  documentArtifact: "89000000-0000-8000-8000-000000000852",
  name: "Pessoa Sintética Beta",
};
const encryption = {
  activeKeyVersion: "v1",
  encryptionKeys: new Map([["v1", new Uint8Array(32).fill(1)]]),
  blindIndexVersion: "v1",
  blindIndexKey: new Uint8Array(32).fill(3),
};
const protector = new AesGcmIdentifierProtector(encryption);
const PDF = Buffer.from("%PDF-1.7\nsynthetic lifecycle contract\n%%EOF\n");
const PDF_HASH = `sha256:${createHash("sha256").update(PDF).digest("hex")}`;
let root = "";

const documentObject = (tenant: {
  readonly tenant: string;
  readonly document: string;
  readonly documentArtifact: string;
}): string =>
  `documents/tenant/${tenant.tenant}/${tenant.document}/${tenant.documentArtifact}.pdf`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "meu-processo-lifecycle-e2e-"));
  const client = await admin.connect();
  try {
    await client.query("begin");
    for (const [index, tenant] of [A, B].entries()) {
      const protectedName = protector.protect({
        tenantId: tenant.tenant,
        identifierType: "name",
        canonicalValue: tenant.name.toLocaleLowerCase("pt-BR"),
        plaintext: tenant.name,
      });
      await client.query(
        "insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)",
        [tenant.user, `lifecycle-worker-e2e-${index}`],
      );
      await client.query(
        `insert into app_private.tenants(
           tenant_id,tenant_kind,personal_owner_user_id
         ) values($1,'personal',$2)`, [tenant.tenant, tenant.user],
      );
      await client.query(
        `insert into app_private.tenant_members(
           tenant_id,user_id,membership_role
         ) values($1,$2,'owner')`, [tenant.tenant, tenant.user],
      );
      await client.query(
        `insert into app_private.monitored_subjects(
           tenant_id,subject_id,subject_type,display_label,protected_reference,
           encrypted_value,key_version
         ) values($1,$2,'name',$3,$4,$5,$6)`,
        [tenant.tenant, tenant.subject, `Pessoa ${index}`,
          protectedName.protectedReference, protectedName.encryptedValue,
          protectedName.keyVersion],
      );
      await client.query(
        `insert into app_private.case_records(
           tenant_id,case_id,cnj_normalized,tribunal_code,
           first_seen_at,last_projected_at
         ) values($1,$2,$3,'TJZZ',statement_timestamp()-interval '1 day',
           statement_timestamp())`,
        [tenant.tenant, tenant.caseId,
          `000000${index + 1}-23.2026.8.99.081${index + 1}`],
      );
      await client.query(
        `insert into app_private.source_envelopes(
           tenant_id,envelope_id,source_id,external_id,content_hash,retrieved_at
         ) values($1,$2,$3,$4,$5,statement_timestamp())`,
        [tenant.tenant, tenant.envelope, SOURCE, `lifecycle-e2e-${index}`,
          `sha256:${String(index + 1).repeat(64)}`],
      );
      await client.query(
        `insert into app_private.document_records(
           tenant_id,document_id,case_id,source_id,envelope_id,
           external_document_id,document_type,title,access_class,
           availability_status,source_created_at,last_verified_at
         ) values($1,$2,$3,$4,$5,$6,'decisao',$7,'public_official',
           'available',statement_timestamp()-interval '1 hour',
           statement_timestamp())`,
        [tenant.tenant, tenant.document, tenant.caseId, SOURCE, tenant.envelope,
          `lifecycle-document-${index}`, `Documento sintético ${index}`],
      );
      await client.query(
        `insert into app_private.document_artifacts(
           tenant_id,artifact_id,document_id,scope_kind,storage_object_id,
           content_hash,media_type,size_bytes,malware_scan_status,
           encryption_key_version,expires_at
         ) values($1,$2,$3,'tenant_private',$4,$5,'application/pdf',$6,
           'clean','v1',statement_timestamp()+interval '72 hours')`,
        [tenant.tenant, tenant.documentArtifact, tenant.document,
          documentObject(tenant), PDF_HASH, PDF.byteLength],
      );
      const path = join(root, ...documentObject(tenant).split("/"));
      await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
      await writeFile(path, PDF, { flag: "wx", mode: 0o600 });
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
  await Promise.all([admin.end(), runtime.end(), lifecycle.end()]);
  if (root) await rm(root, { recursive: true, force: true });
});

describe("tenant data lifecycle worker database contract", () => {
  it("exports and expires A/B without mixing, then deletes only A", async () => {
    const requests = new PostgresTenantDataLifecycleRequestRepository(runtime);
    const start = new Date();
    await requests.requestExport(
      { userId: A.user, tenantId: A.tenant },
      { requestId: A.exportRequest, requestedAt: start },
    );
    await requests.requestExport(
      { userId: B.user, tenantId: B.tenant },
      { requestId: B.exportRequest,
        requestedAt: new Date(start.getTime() + 1) },
    );
    let now = new Date(start.getTime() + 100);
    const artifacts = [A.exportArtifact, B.exportArtifact];
    const store = await LocalTenantLifecycleObjectStore.create(root, 10 * 1024 * 1024);
    const worker = new TenantDataLifecycleWorker(
      new PostgresTenantDataLifecycleWorkerRepository(lifecycle),
      store, protector, () => undefined,
      {
        workerId: "lifecycle-e2e", batchSize: 10, leaseDurationMs: 60_000,
        baseBackoffMs: 60_000, maxBackoffMs: 3_600_000, maxAttempts: 3,
        maximumExportBytes: 10 * 1024 * 1024, expirationBatchSize: 10,
      },
      () => now,
      () => artifacts.shift()!,
    );

    await expect(worker.runTick()).resolves.toMatchObject({
      claimed: 2, exported: 2, deleted: 0,
    });
    const exported = await admin.query<{
      tenant_id: string; artifact_object_id: string; status: string;
    }>(
      `select tenant_id,artifact_object_id,status
         from app_private.tenant_data_lifecycle_requests
        where request_id in ($1,$2) order by tenant_id`,
      [A.exportRequest, B.exportRequest],
    );
    expect(exported.rows.every((row) => row.status === "completed")).toBe(true);
    const aJson = await readFile(join(root, ...exported.rows[0]!.artifact_object_id.split("/")), "utf8");
    const bJson = await readFile(join(root, ...exported.rows[1]!.artifact_object_id.split("/")), "utf8");
    expect(aJson).toContain(A.name);
    expect(aJson).not.toContain(B.name);
    expect(bJson).toContain(B.name);
    expect(bJson).not.toContain(A.name);
    for (const json of [aJson, bJson]) {
      expect(json).not.toContain("encryptedValue");
      expect(json).not.toContain("provider_subject");
      expect(json).not.toContain("leaseToken");
    }

    now = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1);
    await expect(worker.runTick()).resolves.toMatchObject({
      expired: 2, claimed: 0,
    });
    for (const row of exported.rows) {
      await expect(readFile(join(root, ...row.artifact_object_id.split("/"))))
        .rejects.toMatchObject({ code: "ENOENT" });
    }

    await requests.requestDeletion(
      { userId: A.user, tenantId: A.tenant },
      { requestId: A.deletionRequest,
        requestedAt: new Date(now.getTime() + 1), confirmed: true },
    );
    now = new Date(now.getTime() + 100);
    await expect(worker.runTick()).resolves.toMatchObject({
      claimed: 1, deleted: 1,
    });
    await expect(readFile(join(root, ...documentObject(A).split("/"))))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, ...documentObject(B).split("/"))))
      .resolves.toEqual(PDF);
    const result = await admin.query(
      `select
         (select status from app_private.tenants where tenant_id=$1) as a_status,
         (select status from app_private.tenants where tenant_id=$2) as b_status,
         (select purged_object_count from app_private.tenant_deletion_tombstones
           where tenant_id=$1) as purged_object_count`,
      [A.tenant, B.tenant],
    );
    expect(result.rows[0]).toEqual({
      a_status: "deleted", b_status: "active", purged_object_count: "2",
    });
  });
});
