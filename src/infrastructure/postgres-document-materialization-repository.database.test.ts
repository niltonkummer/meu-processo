import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DocumentMaterializationWorkConflictError } from
  "../application/document-materialization-worker.js";
import { PostgresDocumentMaterializationRepository } from
  "./postgres-document-materialization-repository.js";
import { PostgresDocumentMaterializationRequestRepository } from
  "./postgres-document-materialization-request-repository.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DOCUMENT_WORKER_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !workerUrl) {
  throw new Error("Database URLs are required for materialization contracts.");
}
const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 4 });
const workerPool = new Pool({ connectionString: workerUrl, max: 4 });

const USER = "00000000-0000-7000-8000-000000000691";
const TENANT = "10000000-0000-7000-8000-000000000691";
const FOREIGN_USER = "00000000-0000-7000-8000-000000000692";
const FOREIGN_TENANT = "10000000-0000-7000-8000-000000000692";
const CASE = "83000000-0000-7000-8000-000000000691";
const DOCUMENT_1 = "88000000-0000-7000-8000-000000000691";
const DOCUMENT_2 = "88000000-0000-7000-8000-000000000692";
const MATERIALIZATION_1 = "72000000-0000-7000-8000-000000000691";
const MATERIALIZATION_2 = "72000000-0000-7000-8000-000000000692";
const SOURCE = "40000000-0000-7000-8000-000000009999";
const ENVELOPE = "81000000-0000-7000-8000-000000000691";
const EXTERNAL_1 = "90000000-0000-7000-8000-000000000691";
const EXTERNAL_2 = "90000000-0000-7000-8000-000000000692";

interface MaterializationRequestRow {
  materialization_id: string;
  document_id: string;
  state: string;
}

const request = async (
  client: PoolClient,
  context: { userId: string; tenantId: string },
  documentId: string,
  materializationId: string,
  requestedAt: Date,
) => {
  await client.query("begin");
  try {
    await client.query(
      `select set_config('app.current_user_id',$1,true),
              set_config('app.current_tenant_id',$2,true)`,
      [context.userId, context.tenantId],
    );
    const result = await client.query<MaterializationRequestRow>(
      `select * from app_private.request_tenant_document_materialization(
         $1::uuid,$2::uuid,$3::uuid,$4::timestamptz
       )`,
      [CASE, documentId, materializationId, requestedAt],
    );
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("begin");
    for (const [user, tenant, provider] of [
      [USER, TENANT, "materialization-user"],
      [FOREIGN_USER, FOREIGN_TENANT, "materialization-foreign"],
    ]) {
      await client.query(
        "insert into app_private.user_accounts(user_id,provider_subject) values($1,$2)",
        [user, provider],
      );
      await client.query(
        `insert into app_private.tenants(
           tenant_id,tenant_kind,personal_owner_user_id
         ) values($1,'personal',$2)`, [tenant, user],
      );
      await client.query(
        `insert into app_private.tenant_members(
           tenant_id,user_id,membership_role
         ) values($1,$2,'owner')`, [tenant, user],
      );
    }
    await client.query(`insert into app_private.case_records(
      tenant_id,case_id,cnj_normalized,tribunal_code,first_seen_at,last_projected_at
    ) values($1,$2,'0000001-23.2026.8.99.0691','TJZZ',
      statement_timestamp()-interval '1 day',statement_timestamp())`, [TENANT, CASE]);
    await client.query(`insert into app_private.tenant_cases(
      tenant_id,tenant_case_id,case_id,granted_at
    ) values($1,'85000000-0000-7000-8000-000000000691',$2,statement_timestamp())`,
    [TENANT, CASE]);
    await client.query(`insert into app_private.source_envelopes(
      tenant_id,envelope_id,source_id,external_id,content_hash,retrieved_at
    ) values($1,$2,$3,'materialization-envelope',$4,statement_timestamp())`,
    [TENANT, ENVELOPE, SOURCE, `sha256:${"e".repeat(64)}`]);
    for (const [document, external, title] of [
      [DOCUMENT_1, EXTERNAL_1, "Synthetic document one"],
      [DOCUMENT_2, EXTERNAL_2, "Synthetic document two"],
    ]) {
      await client.query(`insert into app_private.document_records(
        tenant_id,document_id,case_id,source_id,envelope_id,
        external_document_id,document_type,title,access_class,
        availability_status,source_created_at,last_verified_at
      ) values($1,$2,$3,$4,$5,$6,'decisao',$7,'public_official',
        'metadata_only',statement_timestamp()-interval '1 hour',statement_timestamp())`,
      [TENANT, document, CASE, SOURCE, ENVELOPE, external, title]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
});

afterAll(async () => {
  await Promise.all([admin.end(), runtime.end(), workerPool.end()]);
});

describe("PostgresDocumentMaterializationRepository database contract", () => {
  it("requests idempotently, claims once concurrently and completes one artifact", async () => {
    const requestedAt = new Date();
    const requestRepository =
      new PostgresDocumentMaterializationRequestRepository(runtime);
    const first = await requestRepository.request(
      { userId: USER, tenantId: TENANT },
      { caseId: CASE, documentId: DOCUMENT_1,
        materializationId: MATERIALIZATION_1, requestedAt },
    );
    const duplicate = await requestRepository.request(
      { userId: USER, tenantId: TENANT },
      { caseId: CASE, documentId: DOCUMENT_1,
        materializationId: "72000000-0000-7000-8000-000000000699", requestedAt },
    );
    const foreign = await requestRepository.request(
      { userId: FOREIGN_USER, tenantId: FOREIGN_TENANT },
      { caseId: CASE, documentId: DOCUMENT_1,
        materializationId: "72000000-0000-7000-8000-000000000698", requestedAt },
    );
    expect(first).toEqual({
      materializationId: MATERIALIZATION_1,
      documentId: DOCUMENT_1,
      state: "queued",
    });
    expect(duplicate).toEqual(first);
    expect(foreign).toBeNull();

    const repositoryA = new PostgresDocumentMaterializationRepository(
      workerPool,
      () => "71000000-0000-7000-8000-000000000691",
      () => "lease-token-materialization-a",
      () => "73000000-0000-7000-8000-000000000691",
    );
    const repositoryB = new PostgresDocumentMaterializationRepository(
      workerPool,
      () => "71000000-0000-7000-8000-000000000692",
      () => "lease-token-materialization-b",
      () => "73000000-0000-7000-8000-000000000692",
    );
    const claimedAt = new Date(requestedAt.getTime() + 100);
    const claims = await Promise.all([
      repositoryA.claimDue({
        workerId: "worker-a", now: claimedAt, limit: 1, leaseDurationMs: 60_000,
      }),
      repositoryB.claimDue({
        workerId: "worker-b", now: claimedAt, limit: 1, leaseDurationMs: 60_000,
      }),
    ]);
    expect(claims.flat()).toHaveLength(1);
    const claim = claims.flat()[0]!;
    expect(claim).toMatchObject({
      tenantId: TENANT, jobId: MATERIALIZATION_1, documentId: DOCUMENT_1,
      sourceCode: "synthetic-worker", externalDocumentId: EXTERNAL_1,
      attemptCount: 1,
    });
    const repository = claim.executionId.endsWith("691") ? repositoryA : repositoryB;
    const artifactId = "89000000-0000-8000-8000-000000000691";
    const completedAt = new Date(claimedAt.getTime() + 1_000);
    const completion = {
      executionId: claim.executionId,
      leaseToken: claim.leaseToken,
      completedAt,
      artifactId,
      storageObjectId:
        `documents/tenant/${TENANT}/${DOCUMENT_1}/${artifactId}.pdf`,
      contentHash: `sha256:${"a".repeat(64)}`,
      mediaType: "application/pdf" as const,
      sizeBytes: 512,
      expiresAt: new Date(completedAt.getTime() + 86_400_000),
    };
    await expect(repository.complete(completion)).resolves.toBeUndefined();
    await expect(repository.complete(completion)).resolves.toBeUndefined();
    const persisted = await admin.query(`select job.status, artifact.document_id,
      artifact.artifact_id, artifact.malware_scan_status,
      document.availability_status
      from app_private.document_materialization_jobs job
      join app_private.document_records document
        on document.tenant_id=job.tenant_id and document.document_id=job.document_id
      join app_private.document_artifacts artifact
        on artifact.tenant_id=job.tenant_id and artifact.document_id=job.document_id
      where job.tenant_id=$1 and job.document_id=$2`, [TENANT, DOCUMENT_1]);
    expect(persisted.rows).toEqual([{
      status: "completed", document_id: DOCUMENT_1, artifact_id: artifactId,
      malware_scan_status: "clean", availability_status: "available",
    }]);
    await expect(requestRepository.request(
      { userId: USER, tenantId: TENANT },
      { caseId: CASE, documentId: DOCUMENT_1,
        materializationId: MATERIALIZATION_1, requestedAt: new Date() },
    )).resolves.toEqual({
      materializationId: MATERIALIZATION_1,
      documentId: DOCUMENT_1,
      state: "available",
    });
  });

  it("recovers an expired lease and rejects the late acknowledgement", async () => {
    const requestedAt = new Date();
    const client = await runtime.connect();
    try {
      await request(client, { userId: USER, tenantId: TENANT },
        DOCUMENT_2, MATERIALIZATION_2, requestedAt);
    } finally { client.release(); }
    const first = new PostgresDocumentMaterializationRepository(
      workerPool,
      () => "71000000-0000-7000-8000-000000000693",
      () => "lease-token-materialization-c",
      () => "73000000-0000-7000-8000-000000000693",
    );
    const second = new PostgresDocumentMaterializationRepository(
      workerPool,
      () => "71000000-0000-7000-8000-000000000694",
      () => "lease-token-materialization-d",
      () => "73000000-0000-7000-8000-000000000694",
    );
    const initial = await first.claimDue({
      workerId: "worker-c", now: new Date(requestedAt.getTime() + 100),
      limit: 1, leaseDurationMs: 30_000,
    });
    const recovered = await second.claimDue({
      workerId: "worker-d", now: new Date(requestedAt.getTime() + 31_000),
      limit: 1, leaseDurationMs: 30_000,
    });
    expect(initial[0]?.attemptCount).toBe(1);
    expect(recovered[0]?.attemptCount).toBe(2);
    await expect(first.fail({
      executionId: initial[0]!.executionId,
      leaseToken: initial[0]!.leaseToken,
      failedAt: new Date(requestedAt.getTime() + 31_100),
      failureCode: "SOURCE_FAILED", nextAttemptAt: null, terminal: true,
    })).rejects.toBeInstanceOf(DocumentMaterializationWorkConflictError);
    await expect(second.fail({
      executionId: recovered[0]!.executionId,
      leaseToken: recovered[0]!.leaseToken,
      failedAt: new Date(requestedAt.getTime() + 31_100),
      failureCode: "DOCUMENT_INVALID", nextAttemptAt: null, terminal: true,
    })).resolves.toBeUndefined();
  });

  it("denies direct queue access to both runtime and document worker", async () => {
    for (const pool of [runtime, workerPool]) {
      await expect(pool.query(
        "select * from app_private.document_materialization_jobs",
      )).rejects.toMatchObject({ code: "42501" });
    }
  });
});
