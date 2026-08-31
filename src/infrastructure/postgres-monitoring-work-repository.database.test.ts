import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MonitoringWorker,
  MonitoringWorkConflictError,
} from "../application/monitoring-worker.js";
import { AesGcmIdentifierProtector } from "./aes-gcm-identifier-protector.js";
import { PostgresMonitoringWorkRepository } from "./postgres-monitoring-work-repository.js";

const workerConnectionString = process.env.WORKER_DATABASE_URL;
const adminConnectionString = process.env.DATABASE_ADMIN_URL;
if (!workerConnectionString || !adminConnectionString) {
  throw new Error(
    "WORKER_DATABASE_URL and DATABASE_ADMIN_URL are required for worker database tests.",
  );
}

const TENANT_ID = "10000000-0000-7000-8000-000000000991";
const USER_ID = "00000000-0000-7000-8000-000000000991";
const SUBJECT_ID = "20000000-0000-7000-8000-000000000991";
const TARGET_ID = "30000000-0000-7000-8000-000000000991";
const STATE_ID = "50000000-0000-7000-8000-000000000991";
const SOURCE_ID = "40000000-0000-7000-8000-000000009999";
const NOW = new Date("2026-08-30T12:00:00.000Z");
const NEXT = new Date("2026-08-31T12:00:00.000Z");
const RETRY_AT = new Date("2026-08-31T13:00:00.000Z");

const adminPool = new Pool({ connectionString: adminConnectionString, max: 1 });
const workerPool = new Pool({ connectionString: workerConnectionString, max: 2 });

beforeAll(async () => {
  const client = await adminPool.connect();
  try {
    await client.query("begin");
    for (const table of [
      "tenant_cases",
      "case_external_references",
      "canonical_observations",
      "source_envelopes",
      "case_records",
      "outbox_events",
      "monitoring_observation_receipts",
      "monitoring_executions",
      "target_source_states",
      "subject_targets",
      "monitoring_targets",
      "monitored_subjects",
      "tenant_members",
      "tenants",
    ]) {
      await client.query(
        `delete from app_private.${table} where tenant_id = $1::uuid`,
        [TENANT_ID],
      );
    }
    await client.query(
      "delete from app_private.user_accounts where user_id = $1::uuid",
      [USER_ID],
    );
    await client.query(
      `insert into app_private.user_accounts (user_id, provider_subject)
       values ($1::uuid, 'provider-worker-postgres-synthetic')`,
      [USER_ID],
    );
    await client.query(
      `insert into app_private.tenants (
         tenant_id, tenant_kind, personal_owner_user_id
       ) values ($2::uuid, 'personal', $1::uuid)`,
      [USER_ID, TENANT_ID],
    );
    await client.query(
      `insert into app_private.tenant_members (
         tenant_id, user_id, membership_role
       ) values ($2::uuid, $1::uuid, 'owner')`,
      [USER_ID, TENANT_ID],
    );
    await client.query(
      `insert into app_private.monitored_subjects (
         tenant_id, subject_id, subject_type, display_label,
         protected_reference, encrypted_value, key_version
       ) values (
         $1::uuid, $2::uuid, 'name', 'P. S.',
         'hmac-sha256:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
         'aes-256-gcm:v1:AAAAAAAAAAAAAAAA:AQ:BBBBBBBBBBBBBBBBBBBBBB',
         'v1'
       )`,
      [TENANT_ID, SUBJECT_ID],
    );
    await client.query(
      `insert into app_private.monitoring_targets (
         tenant_id, target_id, target_type, display_label, protected_reference
       ) values (
         $1::uuid, $2::uuid, 'name', 'P. S.',
         'hmac-sha256:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
       )`,
      [TENANT_ID, TARGET_ID],
    );
    await client.query(
      `insert into app_private.subject_targets (tenant_id, subject_id, target_id)
       values ($1::uuid, $2::uuid, $3::uuid)`,
      [TENANT_ID, SUBJECT_ID, TARGET_ID],
    );
    await client.query(
      `insert into app_private.target_source_states (
         tenant_id, state_id, target_id, source_id, status, next_attempt_at
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ready', $5)`,
      [TENANT_ID, STATE_ID, TARGET_ID, SOURCE_ID, NOW],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await workerPool.end();
  await adminPool.end();
});

describe("PostgresMonitoringWorkRepository", () => {
  it("claims concurrently once, completes idempotently and writes minimized outbox", async () => {
    const first = new PostgresMonitoringWorkRepository(
      workerPool,
      () => "60000000-0000-7000-8000-000000000991",
      () => "synthetic-worker-lease-token-a",
      () => "70000000-0000-7000-8000-000000000991",
    );
    const second = new PostgresMonitoringWorkRepository(
      workerPool,
      () => "60000000-0000-7000-8000-000000000992",
      () => "synthetic-worker-lease-token-b",
      () => "70000000-0000-7000-8000-000000000992",
    );
    const claim = {
      workerId: "postgres-worker",
      now: NOW,
      limit: 1,
      leaseDurationMs: 60_000,
    };

    const results = await Promise.all([first.claimDue(claim), second.claimDue(claim)]);
    expect(results.map((items) => items.length).sort()).toEqual([0, 1]);
    const work = results.flat()[0]!;
    const owner = work.executionId.endsWith("991") ? first : second;
    const command = {
      executionId: work.executionId,
      leaseToken: work.leaseToken,
      completedAt: new Date("2026-08-30T12:00:30.000Z"),
      nextAttemptAt: NEXT,
      observations: Array.from({ length: 2 }, () => ({
          externalId: "synthetic-publication-991",
          contentHash: `sha256:${"a".repeat(64)}`,
          parserVersion: "synthetic-v1",
          schemaVersion: 1 as const,
          cnjNumber: "0000001-23.2026.8.99.0991",
          tribunalCode: "TJZZ",
          collectedAt: new Date("2026-08-30T12:00:20.000Z"),
          eventType: "publication" as const,
          externalEventKey: "publication-991",
          occurredAt: new Date("2026-08-30T11:00:00.000Z"),
          title: "Publicação sintética 991",
          plainTextExcerpt: "Trecho sintético 991.",
        })),
    };
    await owner.complete(command);
    await owner.complete(command);

    await expect(
      owner.complete({ ...command, leaseToken: "wrong-synthetic-lease-token" }),
    ).rejects.toBeInstanceOf(MonitoringWorkConflictError);

    const evidence = await adminPool.query<{
      execution_count: string;
      receipt_count: string;
      envelope_count: string;
      observation_count: string;
      case_count: string;
      tenant_case_count: string;
      case_event_count: string;
      event_evidence_count: string;
      outbox_count: string;
      plaintext_absent: boolean;
    }>(
      `select
         (select count(*) from app_private.monitoring_executions
           where tenant_id = $1::uuid) as execution_count,
         (select count(*) from app_private.monitoring_observation_receipts
           where tenant_id = $1::uuid) as receipt_count,
         (select count(*) from app_private.source_envelopes
           where tenant_id = $1::uuid) as envelope_count,
         (select count(*) from app_private.canonical_observations
           where tenant_id = $1::uuid) as observation_count,
         (select count(*) from app_private.case_records
           where tenant_id = $1::uuid) as case_count,
         (select count(*) from app_private.tenant_cases
           where tenant_id = $1::uuid) as tenant_case_count,
         (select count(*) from app_private.case_events
           where tenant_id = $1::uuid) as case_event_count,
         (select count(*) from app_private.event_evidence
           where tenant_id = $1::uuid) as event_evidence_count,
         (select count(*) from app_private.outbox_events
           where tenant_id = $1::uuid) as outbox_count,
         not exists (
           select 1 from app_private.outbox_events
            where tenant_id = $1::uuid
              and payload::text like '%P. S.%'
         ) as plaintext_absent`,
      [TENANT_ID],
    );
    expect(evidence.rows[0]).toEqual({
      execution_count: "1",
      receipt_count: "1",
      envelope_count: "1",
      observation_count: "1",
      case_count: "1",
      tenant_case_count: "1",
      case_event_count: "1",
      event_evidence_count: "1",
      outbox_count: "1",
      plaintext_absent: true,
    });
  });

  it("runs the full protected synthetic worker path without persisting plaintext", async () => {
    const tenantId = "10000000-0000-7000-8000-000000000981";
    const userId = "00000000-0000-7000-8000-000000000981";
    const subjectId = "20000000-0000-7000-8000-000000000981";
    const targetId = "30000000-0000-7000-8000-000000000981";
    const stateId = "50000000-0000-7000-8000-000000000981";
    const plaintext = "Pessoa Sintética Worker";
    const protector = new AesGcmIdentifierProtector({
      activeKeyVersion: "v1",
      encryptionKeys: new Map([["v1", Buffer.alloc(32, 1)]]),
      blindIndexVersion: "v1",
      blindIndexKey: Buffer.alloc(32, 3),
    });
    const protectedIdentifier = protector.protect({
      tenantId,
      identifierType: "name",
      canonicalValue: "PESSOA SINTETICA WORKER",
      plaintext,
    });
    const admin = await adminPool.connect();
    try {
      await admin.query("begin");
      await admin.query(
        `insert into app_private.user_accounts (user_id, provider_subject)
         values ($1::uuid, 'provider-worker-integration-synthetic')`,
        [userId],
      );
      await admin.query(
        `insert into app_private.tenants (
           tenant_id, tenant_kind, personal_owner_user_id
         ) values ($1::uuid, 'personal', $2::uuid)`,
        [tenantId, userId],
      );
      await admin.query(
        `insert into app_private.tenant_members (
           tenant_id, user_id, membership_role
         ) values ($1::uuid, $2::uuid, 'owner')`,
        [tenantId, userId],
      );
      await admin.query(
        `insert into app_private.monitored_subjects (
           tenant_id, subject_id, subject_type, display_label,
           protected_reference, encrypted_value, key_version
         ) values ($1::uuid, $2::uuid, 'name', 'P. S. W.', $3, $4, $5)`,
        [
          tenantId,
          subjectId,
          protectedIdentifier.protectedReference,
          protectedIdentifier.encryptedValue,
          protectedIdentifier.keyVersion,
        ],
      );
      await admin.query(
        `insert into app_private.monitoring_targets (
           tenant_id, target_id, target_type, display_label, protected_reference
         ) values ($1::uuid, $2::uuid, 'name', 'P. S. W.', $3)`,
        [tenantId, targetId, protectedIdentifier.protectedReference],
      );
      await admin.query(
        `insert into app_private.subject_targets (tenant_id, subject_id, target_id)
         values ($1::uuid, $2::uuid, $3::uuid)`,
        [tenantId, subjectId, targetId],
      );
      await admin.query(
        `insert into app_private.target_source_states (
           tenant_id, state_id, target_id, source_id, status, next_attempt_at
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ready', $5)`,
        [tenantId, stateId, targetId, SOURCE_ID, NOW],
      );
      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");
      throw error;
    } finally {
      admin.release();
    }

    const collectedValues: string[] = [];
    const repository = new PostgresMonitoringWorkRepository(
      workerPool,
      () => "60000000-0000-7000-8000-000000000981",
      () => "synthetic-worker-integration-lease",
      () => "70000000-0000-7000-8000-000000000981",
    );
    const worker = new MonitoringWorker(
      repository,
      protector,
      {
        resolve: (sourceCode) =>
          sourceCode === "synthetic-worker"
            ? {
                sourceCode,
                collect: ({ value }) => {
                  collectedValues.push(value);
                  return Promise.resolve([
                    {
                      externalId: "synthetic-integration-publication",
                      contentHash: `sha256:${"b".repeat(64)}`,
                      parserVersion: "synthetic-integration-v1",
                      schemaVersion: 1,
                      cnjNumber: "0000001-23.2026.8.99.0991",
                      tribunalCode: "TJZZ",
                      collectedAt: NOW,
                      eventType: "publication",
                      externalEventKey: "integration-publication",
                      occurredAt: new Date("2026-08-30T11:00:00.000Z"),
                      title: "Publicação de integração",
                      plainTextExcerpt: "Trecho de integração.",
                    },
                  ]);
                },
              }
            : undefined,
      },
      () => undefined,
      {
        workerId: "postgres-integration-worker",
        batchSize: 1,
        leaseDurationMs: 60_000,
        successIntervalMs: 604_800_000,
        baseBackoffMs: 300_000,
        maxBackoffMs: 86_400_000,
        maxFailures: 5,
      },
      () => NOW,
    );

    await expect(worker.runTick()).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(collectedValues).toEqual([plaintext]);

    const evidence = await adminPool.query<{
      execution_status: string;
      state_status: string;
      receipt_count: string;
      envelope_count: string;
      case_count: string;
      outbox_count: string;
      plaintext_absent: boolean;
    }>(
      `select
         (select status from app_private.monitoring_executions
           where tenant_id = $1::uuid) as execution_status,
         (select status from app_private.target_source_states
           where tenant_id = $1::uuid and state_id = $2::uuid) as state_status,
         (select count(*) from app_private.monitoring_observation_receipts
           where tenant_id = $1::uuid) as receipt_count,
         (select count(*) from app_private.source_envelopes
           where tenant_id = $1::uuid) as envelope_count,
         (select count(*) from app_private.case_records
           where tenant_id = $1::uuid) as case_count,
         (select count(*) from app_private.outbox_events
           where tenant_id = $1::uuid) as outbox_count,
         not exists (
           select 1 from app_private.outbox_events
            where tenant_id = $1::uuid and payload::text like '%' || $3 || '%'
         ) as plaintext_absent`,
      [tenantId, stateId, plaintext],
    );
    expect(evidence.rows[0]).toEqual({
      execution_status: "completed",
      state_status: "ready",
      receipt_count: "1",
      envelope_count: "1",
      case_count: "1",
      outbox_count: "1",
      plaintext_absent: true,
    });
  });

  it("persists a retryable failure once and denies direct worker table access", async () => {
    const repository = new PostgresMonitoringWorkRepository(
      workerPool,
      () => "60000000-0000-7000-8000-000000000993",
      () => "synthetic-worker-lease-token-c",
      () => "70000000-0000-7000-8000-000000000993",
    );
    const work = (
      await repository.claimDue({
        workerId: "postgres-worker",
        now: NEXT,
        limit: 1,
        leaseDurationMs: 60_000,
      })
    )[0]!;
    const failure = {
      executionId: work.executionId,
      leaseToken: work.leaseToken,
      failedAt: new Date("2026-08-31T12:00:30.000Z"),
      failureCode: "SOURCE_TIMEOUT",
      nextAttemptAt: RETRY_AT,
      terminal: false,
    };
    await repository.fail(failure);
    await repository.fail(failure);

    const state = await adminPool.query<{
      status: string;
      consecutive_failures: number;
      outbox_count: string;
    }>(
      `select status, consecutive_failures,
              (select count(*) from app_private.outbox_events
                where tenant_id = $1::uuid) as outbox_count
         from app_private.target_source_states
        where tenant_id = $1::uuid and state_id = $2::uuid`,
      [TENANT_ID, STATE_ID],
    );
    expect(state.rows[0]).toEqual({
      status: "backoff",
      consecutive_failures: 1,
      outbox_count: "2",
    });
    await expect(
      workerPool.query("select count(*) from app_private.monitoring_executions"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("reuses tenant-private evidence and preserves a new parser observation", async () => {
    const repository = new PostgresMonitoringWorkRepository(
      workerPool,
      () => "60000000-0000-7000-8000-000000000994",
      () => "synthetic-worker-lease-token-d",
      () => "70000000-0000-7000-8000-000000000994",
    );
    const work = (
      await repository.claimDue({
        workerId: "postgres-worker",
        now: RETRY_AT,
        limit: 1,
        leaseDurationMs: 60_000,
      })
    )[0]!;
    await repository.complete({
      executionId: work.executionId,
      leaseToken: work.leaseToken,
      completedAt: new Date("2026-08-31T13:00:30.000Z"),
      nextAttemptAt: new Date("2026-09-01T13:00:30.000Z"),
      observations: [
        {
          externalId: "synthetic-publication-991",
          contentHash: `sha256:${"a".repeat(64)}`,
          parserVersion: "synthetic-v2",
          schemaVersion: 1,
          cnjNumber: "0000001-23.2026.8.99.0991",
          tribunalCode: "TJZZ",
          collectedAt: new Date("2026-08-30T12:00:20.000Z"),
          eventType: "publication" as const,
          externalEventKey: "publication-991",
          occurredAt: new Date("2026-08-30T11:00:00.000Z"),
          title: "Publicação sintética 991",
          plainTextExcerpt: "Trecho sintético 991.",
        },
      ],
    });

    const evidence = await adminPool.query<{
      envelope_count: string;
      observation_count: string;
      case_count: string;
      reference_count: string;
      tenant_case_count: string;
      outbox_count: string;
      minimized_outbox: boolean;
    }>(
      `select
         (select count(*) from app_private.source_envelopes
           where tenant_id = $1::uuid) as envelope_count,
         (select count(*) from app_private.canonical_observations
           where tenant_id = $1::uuid) as observation_count,
         (select count(*) from app_private.case_records
           where tenant_id = $1::uuid) as case_count,
         (select count(*) from app_private.case_external_references
           where tenant_id = $1::uuid) as reference_count,
         (select count(*) from app_private.tenant_cases
           where tenant_id = $1::uuid) as tenant_case_count,
         (select count(*) from app_private.outbox_events
           where tenant_id = $1::uuid) as outbox_count,
         not exists (
           select 1 from app_private.outbox_events
            where tenant_id = $1::uuid
              and (payload::text like '%0000001-23.2026.8.99.0991%'
                or payload::text like '%TJZZ%'
                or payload::text like '%synthetic-publication-991%')
         ) as minimized_outbox`,
      [TENANT_ID],
    );
    expect(evidence.rows[0]).toEqual({
      envelope_count: "1",
      observation_count: "2",
      case_count: "1",
      reference_count: "1",
      tenant_case_count: "1",
      outbox_count: "3",
      minimized_outbox: true,
    });
  });
});
