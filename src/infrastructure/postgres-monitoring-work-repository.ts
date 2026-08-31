import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import {
  type ClaimedMonitoringWork,
  type MonitoringObservation,
  MonitoringWorkConflictError,
  type MonitoringWorkRepository,
  MonitoringWorkValidationError,
} from "../application/monitoring-worker.js";

interface ClaimRow extends QueryResultRow {
  execution_id: string;
  tenant_id: string;
  state_id: string;
  target_id: string;
  subject_id: string;
  source_code: string;
  subject_type: ClaimedMonitoringWork["subjectType"];
  encrypted_value: string;
  key_version: string;
  consecutive_failures: number;
}

interface AcceptedRow extends QueryResultRow {
  accepted: boolean;
}

type QueryablePool = Pick<Pool, "query">;

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();
const outcomeFingerprint = (value: unknown): Buffer =>
  digest(JSON.stringify(value));

const mapDatabaseError = (error: unknown): Error => {
  if (
    error instanceof MonitoringWorkConflictError ||
    error instanceof MonitoringWorkValidationError
  ) {
    return error;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "22023") return new MonitoringWorkValidationError();
  if (code && ["23503", "23505", "23514", "42501"].includes(code)) {
    return new MonitoringWorkConflictError();
  }
  return error instanceof Error
    ? error
    : new Error("Monitoring work database operation failed.");
};

const serializeObservations = (
  observations: readonly MonitoringObservation[],
): readonly Record<string, unknown>[] =>
  observations.map((item) => ({
    externalId: item.externalId,
    contentHash: item.contentHash,
    parserVersion: item.parserVersion,
    schemaVersion: item.schemaVersion,
    cnjNumber: item.cnjNumber,
    tribunalCode: item.tribunalCode,
    collectedAt: item.collectedAt.toISOString(),
    eventType: item.eventType,
    externalEventKey: item.externalEventKey,
    occurredAt: item.occurredAt.toISOString(),
    title: item.title,
    plainTextExcerpt: item.plainTextExcerpt,
  }));

const serializeEvidence = (
  observations: readonly MonitoringObservation[],
  createId: () => string,
): readonly Record<string, unknown>[] =>
  serializeObservations(observations).map((item) => ({
    ...item,
    envelopeId: createId(),
    observationId: createId(),
    caseId: createId(),
    externalReferenceId: createId(),
    tenantCaseId: createId(),
    caseEventId: createId(),
    eventEvidenceId: createId(),
  }));

export class PostgresMonitoringWorkRepository
  implements MonitoringWorkRepository
{
  constructor(
    private readonly pool: QueryablePool,
    private readonly createExecutionId: () => string = randomUUID,
    private readonly createLeaseToken: () => string = () =>
      randomBytes(32).toString("base64url"),
    private readonly createEventId: () => string = randomUUID,
    private readonly createEvidenceId: () => string = randomUUID,
  ) {}

  async claimDue(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly limit: number;
    readonly leaseDurationMs: number;
  }): Promise<readonly ClaimedMonitoringWork[]> {
    if (
      input.workerId.length < 1 ||
      input.workerId.length > 100 ||
      Number.isNaN(input.now.getTime()) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 25 ||
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 30_000 ||
      input.leaseDurationMs > 900_000
    ) {
      throw new MonitoringWorkValidationError();
    }
    const claims: ClaimedMonitoringWork[] = [];
    try {
      for (let index = 0; index < input.limit; index += 1) {
        const executionId = this.createExecutionId();
        const leaseToken = this.createLeaseToken();
        if (executionId.length < 1 || leaseToken.length < 16) {
          throw new MonitoringWorkValidationError();
        }
        const result = await this.pool.query<ClaimRow>(
          `select execution_id, tenant_id, state_id, target_id, subject_id,
                  source_code, subject_type, encrypted_value, key_version,
                  consecutive_failures
             from app_private.claim_monitoring_work(
               $1::uuid, $2, $3::timestamptz, $4::timestamptz, $5::bytea
             )`,
          [
            executionId,
            input.workerId,
            input.now,
            new Date(input.now.getTime() + input.leaseDurationMs),
            digest(leaseToken),
          ],
        );
        const row = result.rows[0];
        if (!row) break;
        if (row.execution_id !== executionId) {
          throw new MonitoringWorkConflictError();
        }
        claims.push({
          executionId: row.execution_id,
          leaseToken,
          tenantId: row.tenant_id,
          stateId: row.state_id,
          targetId: row.target_id,
          subjectId: row.subject_id,
          sourceCode: row.source_code,
          subjectType: row.subject_type,
          encryptedValue: row.encrypted_value,
          keyVersion: row.key_version,
          consecutiveFailures: row.consecutive_failures,
        });
      }
      return claims;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async complete(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly completedAt: Date;
    readonly nextAttemptAt: Date;
    readonly observations: readonly MonitoringObservation[];
  }): Promise<void> {
    const serialized = serializeObservations(input.observations);
    const evidence = serializeEvidence(
      input.observations,
      this.createEvidenceId,
    );
    const outcome = outcomeFingerprint({
      kind: "complete",
      completedAt: input.completedAt.toISOString(),
      nextAttemptAt: input.nextAttemptAt.toISOString(),
      observations: serialized,
    });
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.complete_monitoring_work(
           $1::uuid, $2::bytea, $3::timestamptz, $4::timestamptz,
           $5::jsonb, $6::bytea, $7::uuid
         ) as accepted`,
        [
          input.executionId,
          digest(input.leaseToken),
          input.completedAt,
          input.nextAttemptAt,
          JSON.stringify(evidence),
          outcome,
          this.createEventId(),
        ],
      );
      if (result.rows[0]?.accepted !== true) {
        throw new MonitoringWorkConflictError();
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async fail(input: {
    readonly executionId: string;
    readonly leaseToken: string;
    readonly failedAt: Date;
    readonly failureCode: string;
    readonly nextAttemptAt: Date | null;
    readonly terminal: boolean;
  }): Promise<void> {
    const outcome = outcomeFingerprint({
      kind: "fail",
      failedAt: input.failedAt.toISOString(),
      failureCode: input.failureCode,
      nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
      terminal: input.terminal,
    });
    try {
      const result = await this.pool.query<AcceptedRow>(
        `select app_private.fail_monitoring_work(
           $1::uuid, $2::bytea, $3::timestamptz, $4, $5::timestamptz,
           $6::boolean, $7::bytea, $8::uuid
         ) as accepted`,
        [
          input.executionId,
          digest(input.leaseToken),
          input.failedAt,
          input.failureCode,
          input.nextAttemptAt,
          input.terminal,
          outcome,
          this.createEventId(),
        ],
      );
      if (result.rows[0]?.accepted !== true) {
        throw new MonitoringWorkConflictError();
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
