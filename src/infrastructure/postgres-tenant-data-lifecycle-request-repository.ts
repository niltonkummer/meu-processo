import type { Pool, PoolClient, QueryResultRow } from "pg";

import { RepositoryAccessDeniedError, type RepositoryContext } from
  "../application/foundation-repository.js";
import {
  TenantDataLifecycleProjectionError,
  type TenantDataLifecycleRequestDetails,
  type TenantDataLifecycleRequestRepository,
  type TenantDataLifecycleRequestResult,
  type TenantDataLifecycleRequestState,
  type TenantDataLifecycleRequestType,
  TenantDataLifecycleRequestValidationError,
} from "../application/tenant-data-lifecycle.js";

interface RequestRow extends QueryResultRow {
  request_id: string;
  request_type: string;
  state: string;
  requested_at: Date;
  completed_at?: Date | null;
  artifact_size_bytes?: string | number | null;
  artifact_expires_at?: Date | null;
  artifact_object_id?: string | null;
  artifact_sha256?: string | null;
}

type ConnectablePool = Pick<Pool, "connect">;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set<TenantDataLifecycleRequestState>([
  "pending", "running", "completed", "failed", "expired",
]);

const validInput = (
  context: RepositoryContext,
  input: { readonly requestId: string; readonly requestedAt: Date },
): boolean =>
  UUID.test(context.userId) && UUID.test(context.tenantId) &&
  UUID.test(input.requestId) && input.requestedAt instanceof Date &&
  !Number.isNaN(input.requestedAt.getTime());

const mapResult = (
  rows: readonly RequestRow[],
  expectedType: TenantDataLifecycleRequestType,
): TenantDataLifecycleRequestResult => {
  if (rows.length !== 1) throw new TenantDataLifecycleProjectionError();
  const row = rows[0]!;
  if (
    !UUID.test(row.request_id) || !["export", "deletion"].includes(row.request_type) ||
    row.request_type !== expectedType ||
    !STATES.has(row.state as TenantDataLifecycleRequestState) ||
    !(row.requested_at instanceof Date) || Number.isNaN(row.requested_at.getTime())
  ) throw new TenantDataLifecycleProjectionError();
  return {
    requestId: row.request_id,
    requestType: expectedType,
    state: row.state as TenantDataLifecycleRequestState,
    requestedAt: row.requested_at,
  };
};

const mapError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof TenantDataLifecycleRequestValidationError ||
    error instanceof TenantDataLifecycleProjectionError
  ) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new TenantDataLifecycleRequestValidationError();
  return new Error("Tenant data lifecycle request failed.");
};

export class PostgresTenantDataLifecycleRequestRepository
  implements TenantDataLifecycleRequestRepository
{
  constructor(private readonly pool: ConnectablePool) {}

  async requestExport(
    context: RepositoryContext,
    input: { readonly requestId: string; readonly requestedAt: Date },
  ): Promise<TenantDataLifecycleRequestResult> {
    return this.request(context, input, "export", false);
  }

  async requestDeletion(
    context: RepositoryContext,
    input: {
      readonly requestId: string;
      readonly requestedAt: Date;
      readonly confirmed: true;
    },
  ): Promise<TenantDataLifecycleRequestResult> {
    return this.request(context, input, "deletion", input.confirmed);
  }

  async get(
    context: RepositoryContext,
    requestId: string,
  ): Promise<TenantDataLifecycleRequestDetails | null> {
    if (!UUID.test(context.userId) || !UUID.test(context.tenantId) ||
        !UUID.test(requestId)) {
      throw new TenantDataLifecycleRequestValidationError();
    }
    try {
      return await this.withTransaction(context, async (client) => {
        const result = await client.query<RequestRow>(
          "select * from app_private.get_tenant_data_lifecycle_request($1::uuid)",
          [requestId],
        );
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) throw new TenantDataLifecycleProjectionError();
        const row = result.rows[0]!;
        const base = mapResult(result.rows, row.request_type as TenantDataLifecycleRequestType);
        const size = row.artifact_size_bytes === null || row.artifact_size_bytes === undefined
          ? null : Number(row.artifact_size_bytes);
        if (
          (row.completed_at !== null && row.completed_at !== undefined &&
            (!(row.completed_at instanceof Date) || Number.isNaN(row.completed_at.getTime()))) ||
          (size !== null && (!Number.isSafeInteger(size) || size < 1 || size > 10_485_760)) ||
          (row.artifact_expires_at !== null && row.artifact_expires_at !== undefined &&
            (!(row.artifact_expires_at instanceof Date) || Number.isNaN(row.artifact_expires_at.getTime()))) ||
          (row.artifact_object_id !== null && row.artifact_object_id !== undefined &&
            typeof row.artifact_object_id !== "string") ||
          (row.artifact_sha256 !== null && row.artifact_sha256 !== undefined &&
            (typeof row.artifact_sha256 !== "string" ||
             !/^sha256:[a-f0-9]{64}$/.test(row.artifact_sha256)))
        ) throw new TenantDataLifecycleProjectionError();
        return {
          ...base,
          completedAt: row.completed_at ?? null,
          artifactSizeBytes: size,
          artifactExpiresAt: row.artifact_expires_at ?? null,
          artifactObjectId: row.artifact_object_id ?? null,
          artifactSha256: row.artifact_sha256 ?? null,
        };
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  private async request(
    context: RepositoryContext,
    input: { readonly requestId: string; readonly requestedAt: Date },
    expectedType: TenantDataLifecycleRequestType,
    confirmed: boolean,
  ): Promise<TenantDataLifecycleRequestResult> {
    if (!validInput(context, input)) {
      throw new TenantDataLifecycleRequestValidationError();
    }
    try {
      return await this.withTransaction(context, async (client) => {
        const result = expectedType === "export"
          ? await client.query<RequestRow>(
              `select * from app_private.request_tenant_data_export(
                 $1::uuid, $2::timestamptz
               )`,
              [input.requestId, input.requestedAt],
            )
          : await client.query<RequestRow>(
              `select * from app_private.request_personal_tenant_deletion(
                 $1::uuid, $2::timestamptz, $3::boolean
               )`,
              [input.requestId, input.requestedAt, confirmed],
            );
        return mapResult(result.rows, expectedType);
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  private async withTransaction<T>(
    context: RepositoryContext,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.current_user_id', $1, true),
                set_config('app.current_tenant_id', $2, true),
                set_config('statement_timeout', '5000', true),
                set_config('lock_timeout', '3000', true),
                set_config('idle_in_transaction_session_timeout', '5000', true)`,
        [context.userId, context.tenantId],
      );
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
