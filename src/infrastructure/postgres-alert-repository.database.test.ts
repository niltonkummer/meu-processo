import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AlertPageValidationError } from "../application/internal-alerts.js";
import { RepositoryAccessDeniedError } from "../application/foundation-repository.js";
import { PostgresAlertRepository } from "./postgres-alert-repository.js";
import { PostgresInternalAlertPublisher } from "./postgres-internal-alert-publisher.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
const dispatcherUrl = process.env.DISPATCHER_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !dispatcherUrl) {
  throw new Error("Database URLs are required for alert contracts.");
}

const admin = new Pool({ connectionString: adminUrl, max: 1 });
const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
const dispatcher = new Pool({ connectionString: dispatcherUrl, max: 2 });
const repository = new PostgresAlertRepository(runtime);
const publisher = new PostgresInternalAlertPublisher(
  dispatcher,
  () => new Date("2026-08-31T12:00:10.000Z"),
);

const USER_A = "00000000-0000-7000-8000-000000000811";
const TENANT_A = "10000000-0000-7000-8000-000000000811";
const USER_B = "00000000-0000-7000-8000-000000000812";
const TENANT_B = "10000000-0000-7000-8000-000000000812";
const SUBJECT = "20000000-0000-7000-8000-000000000811";
const TARGET = "30000000-0000-7000-8000-000000000811";
const STATE = "50000000-0000-7000-8000-000000000811";
const EXECUTION = "80000000-0000-7000-8000-000000000811";
const EVENT = "90000000-0000-7000-8000-000000000811";
const ENVELOPE = "81000000-0000-7000-8000-000000000811";
const OBSERVATION = "82000000-0000-7000-8000-000000000811";
const CASE = "83000000-0000-7000-8000-000000000811";
const TENANT_CASE = "85000000-0000-7000-8000-000000000811";
const SOURCE = "40000000-0000-7000-8000-000000009999";
const HASH = `sha256:${"a".repeat(64)}`;
const payload = { executionId: EXECUTION, observationCount: 1 };
let oldestAlertId: string | undefined;

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("begin");
    for (const [user, tenant, provider] of [
      [USER_A, TENANT_A, "provider-alert-a-synthetic"],
      [USER_B, TENANT_B, "provider-alert-b-synthetic"],
    ]) {
      await client.query(
        "insert into app_private.user_accounts (user_id, provider_subject) values ($1, $2)",
        [user, provider],
      );
      await client.query(
        "insert into app_private.tenants (tenant_id, tenant_kind, personal_owner_user_id) values ($1, 'personal', $2)",
        [tenant, user],
      );
      await client.query(
        "insert into app_private.tenant_members (tenant_id, user_id, membership_role) values ($1, $2, 'owner')",
        [tenant, user],
      );
    }
    await client.query(
      `insert into app_private.monitored_subjects (
         tenant_id, subject_id, subject_type, display_label,
         protected_reference, encrypted_value, key_version
       ) values ($1, $2, 'name', 'Perfil sintético',
         'legacy-reference-alert', 'legacy:v0:unavailable', 'legacy')`,
      [TENANT_A, SUBJECT],
    );
    await client.query(
      `insert into app_private.monitoring_targets (
         tenant_id, target_id, target_type, display_label, protected_reference
       ) values ($1, $2, 'name', 'Perfil sintético', 'legacy-reference-target')`,
      [TENANT_A, TARGET],
    );
    await client.query(
      "insert into app_private.subject_targets (tenant_id, subject_id, target_id) values ($1, $2, $3)",
      [TENANT_A, SUBJECT, TARGET],
    );
    await client.query(
      `insert into app_private.target_source_states (
         tenant_id, state_id, target_id, source_id, status, next_attempt_at
       ) values ($1, $2, $3, $4, 'ready', '2026-09-01T12:00:00Z')`,
      [TENANT_A, STATE, TARGET, SOURCE],
    );
    await client.query(
      `insert into app_private.monitoring_executions (
         execution_id, tenant_id, state_id, worker_id, lease_token_hash,
         leased_until, status, outcome_fingerprint, started_at, finished_at
       ) values ($1, $2, $3, 'synthetic-worker', decode(repeat('11',32),'hex'),
         '2026-08-31T12:01:00Z', 'completed', decode(repeat('22',32),'hex'),
         '2026-08-31T12:00:00Z', '2026-08-31T12:00:05Z')`,
      [EXECUTION, TENANT_A, STATE],
    );
    await client.query(
      `insert into app_private.monitoring_observation_receipts (
         tenant_id, execution_id, external_id, content_hash,
         parser_version, collected_at
       ) values ($1, $2, 'external-alert-1', $3, 'parser-v1',
         '2026-08-31T11:59:00Z')`,
      [TENANT_A, EXECUTION, HASH],
    );
    await client.query(
      `insert into app_private.source_envelopes (
         tenant_id, envelope_id, source_id, external_id, content_hash, retrieved_at
       ) values ($1, $2, $3, 'external-alert-1', $4,
         '2026-08-31T11:59:00Z')`,
      [TENANT_A, ENVELOPE, SOURCE, HASH],
    );
    await client.query(
      `insert into app_private.canonical_observations (
         tenant_id, observation_id, envelope_id, schema_version,
         parser_version, cnj_normalized, tribunal_code, collected_at
       ) values ($1, $2, $3, 1, 'parser-v1',
         '0000001-23.2026.8.99.0811', 'TJZZ', '2026-08-31T11:59:00Z')`,
      [TENANT_A, OBSERVATION, ENVELOPE],
    );
    await client.query(
      `insert into app_private.case_records (
         tenant_id, case_id, cnj_normalized, tribunal_code,
         first_seen_at, last_projected_at
       ) values ($1, $2, '0000001-23.2026.8.99.0811', 'TJZZ',
         '2026-08-31T11:59:00Z', '2026-08-31T12:00:05Z')`,
      [TENANT_A, CASE],
    );
    await client.query(
      `insert into app_private.tenant_cases (
         tenant_id, tenant_case_id, case_id, granted_at
       ) values ($1, $2, $3, '2026-08-31T12:00:05Z')`,
      [TENANT_A, TENANT_CASE, CASE],
    );
    await client.query(
      `insert into app_private.case_events (
         tenant_id, case_event_id, case_id, source_id, event_type,
         external_event_key, occurred_at, title, plain_text_excerpt,
         content_hash, schema_version, projected_at
       ) values ($1, '86000000-0000-7000-8000-000000000811', $2, $3,
         'publication', 'alert-publication-811', '2026-08-31T11:58:00Z',
         'Publicação sintética 811', 'Trecho sintético 811.', $4, 1,
         '2026-08-31T12:00:05Z')`,
      [TENANT_A, CASE, SOURCE, HASH],
    );
    await client.query(
      `insert into app_private.event_evidence (
         tenant_id, event_evidence_id, case_event_id, envelope_id, relation
       ) values ($1, '87000000-0000-7000-8000-000000000811',
         '86000000-0000-7000-8000-000000000811', $2, 'supports')`,
      [TENANT_A, ENVELOPE],
    );
    await client.query(
      `insert into app_private.outbox_events (
         event_id, tenant_id, event_type, aggregate_type, aggregate_id,
         correlation_id, payload, available_at, claimed_by, lease_token_hash,
         leased_until, last_attempt_at, attempt_count
       ) values ($1, $2, 'monitoring.execution.completed.v1',
         'monitoring_execution', $3, $3, $4, '2026-08-31T12:00:05Z',
         'dispatcher-alert-contract', decode(repeat('33',32),'hex'),
         '2026-08-31T12:01:00Z', '2026-08-31T12:00:05Z', 1)`,
      [EVENT, TENANT_A, EXECUTION, payload],
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
  await Promise.all([admin.end(), runtime.end(), dispatcher.end()]);
});

describe("internal alert PostgreSQL contracts", () => {
  it("projects once and lists only the authorized tenant", async () => {
    const event = {
      eventId: EVENT,
      tenantId: TENANT_A,
      eventType: "monitoring.execution.completed.v1",
      aggregateType: "monitoring_execution",
      aggregateId: EXECUTION,
      correlationId: EXECUTION,
      payload,
      idempotencyKey: EVENT,
    };
    await Promise.all([publisher.publish(event), publisher.publish(event)]);
    await publisher.publish(event);
    await expect(publisher.publish({
      ...event,
      payload: { executionId: EXECUTION, observationCount: 2 },
    })).rejects.toThrow("Internal alert projection failed.");

    const page = await repository.list(
      { userId: USER_A, tenantId: TENANT_A },
      { limit: 1, status: "unread" },
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      subjectId: SUBJECT,
      tenantCaseId: TENANT_CASE,
      caseId: CASE,
      caseEventId: "86000000-0000-7000-8000-000000000811",
      cnjNumber: "0000001-23.2026.8.99.0811",
      alertType: "case_discovered",
      status: "unread",
      matchStatus: "unverified",
    });
    oldestAlertId = page.items[0]!.alertId;
    expect(page.next).toBeNull();
    await expect(repository.list(
      { userId: USER_B, tenantId: TENANT_B },
      { limit: 20, status: "all" },
    )).resolves.toEqual({ items: [], next: null });
  });

  it("marks an alert outside the newest page read idempotently and hides foreign identifiers", async () => {
    expect(oldestAlertId).toBeDefined();
    await admin.query(
      `with generated as (
         select sequence,
                ('91000000-0000-7000-8000-' || lpad(sequence::text, 12, '0'))::uuid event_id,
                ('92000000-0000-7000-8000-' || lpad(sequence::text, 12, '0'))::uuid alert_id
           from generate_series(1, 101) sequence
       ), inserted_events as (
         insert into app_private.outbox_events (
           event_id, tenant_id, event_type, aggregate_type, aggregate_id,
           correlation_id, payload, status, available_at, created_at, updated_at
         )
         select event_id, $1, 'monitoring.execution.completed.v1',
                'monitoring_execution', $2, $2, $3, 'pending',
                '2026-08-31T12:01:00Z'::timestamptz + sequence * interval '1 second',
                '2026-08-31T12:01:00Z'::timestamptz + sequence * interval '1 second',
                '2026-08-31T12:01:00Z'::timestamptz + sequence * interval '1 second'
           from generated
         returning event_id
       )
       insert into app_private.alerts (
         tenant_id, alert_id, subject_id, tenant_case_id, case_id,
         case_event_id, source_event_id, alert_type, match_status,
         source_occurred_at, created_at, updated_at
       )
       select $1, generated.alert_id, $4, $5, $6,
              '86000000-0000-7000-8000-000000000811', generated.event_id,
              'case_discovered', 'unverified', '2026-08-31T11:58:00Z',
              '2026-08-31T12:01:00Z'::timestamptz + generated.sequence * interval '1 second',
              '2026-08-31T12:01:00Z'::timestamptz + generated.sequence * interval '1 second'
         from generated
         join inserted_events using (event_id)`,
      [TENANT_A, EXECUTION, payload, SUBJECT, TENANT_CASE, CASE],
    );
    const alertId = oldestAlertId!;
    const readAt = new Date("2026-08-31T12:00:20.000Z");
    await expect(repository.markRead(
      { userId: USER_A, tenantId: TENANT_A }, alertId, readAt,
    )).resolves.toMatchObject({ status: "read", readAt });
    await expect(repository.markRead(
      { userId: USER_A, tenantId: TENANT_A }, alertId, new Date("2026-08-31T12:00:30Z"),
    )).resolves.toMatchObject({ status: "read", readAt });
    await expect(repository.markRead(
      { userId: USER_B, tenantId: TENANT_B }, alertId, readAt,
    )).resolves.toBeNull();
  });

  it("rejects invalid pages, membership and direct table access", async () => {
    await expect(repository.list(
      { userId: USER_A, tenantId: TENANT_A },
      { limit: 102, status: "all" },
    )).rejects.toBeInstanceOf(AlertPageValidationError);
    await expect(repository.list(
      { userId: USER_B, tenantId: TENANT_A },
      { limit: 20, status: "all" },
    )).rejects.toBeInstanceOf(RepositoryAccessDeniedError);
    await expect(runtime.query("select * from app_private.alerts"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
