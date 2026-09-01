import type { RepositoryContext } from "./foundation-repository.js";

export type TenantDataLifecycleRequestType = "export" | "deletion";
export type TenantDataLifecycleRequestState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "expired";

export interface TenantDataLifecycleRequestResult {
  readonly requestId: string;
  readonly requestType: TenantDataLifecycleRequestType;
  readonly state: TenantDataLifecycleRequestState;
  readonly requestedAt: Date;
}

export interface TenantDataLifecycleRequestDetails
  extends TenantDataLifecycleRequestResult {
  readonly completedAt: Date | null;
  readonly artifactSizeBytes: number | null;
  readonly artifactExpiresAt: Date | null;
  readonly artifactObjectId: string | null;
  readonly artifactSha256: string | null;
}

export interface TenantDataLifecycleRequestRepository {
  requestExport(
    context: RepositoryContext,
    input: { readonly requestId: string; readonly requestedAt: Date },
  ): Promise<TenantDataLifecycleRequestResult>;
  requestDeletion(
    context: RepositoryContext,
    input: {
      readonly requestId: string;
      readonly requestedAt: Date;
      readonly confirmed: true;
    },
  ): Promise<TenantDataLifecycleRequestResult>;
  get(
    context: RepositoryContext,
    requestId: string,
  ): Promise<TenantDataLifecycleRequestDetails | null>;
}

export class TenantDataLifecycleRequestValidationError extends Error {
  constructor() {
    super("Tenant data lifecycle request is invalid.");
    this.name = "TenantDataLifecycleRequestValidationError";
  }
}

export class TenantDataLifecycleProjectionError extends Error {
  constructor() {
    super("Tenant data lifecycle projection is invalid.");
    this.name = "TenantDataLifecycleProjectionError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set<TenantDataLifecycleRequestState>([
  "pending", "running", "completed", "failed", "expired",
]);

const validRequest = (
  context: RepositoryContext,
  input: { readonly requestId: string; readonly requestedAt: Date },
): boolean =>
  UUID.test(context.userId) && UUID.test(context.tenantId) &&
  UUID.test(input.requestId) && input.requestedAt instanceof Date &&
  !Number.isNaN(input.requestedAt.getTime());

const validateResult = (
  result: TenantDataLifecycleRequestResult,
  expectedType: TenantDataLifecycleRequestType,
): TenantDataLifecycleRequestResult => {
  if (
    !UUID.test(result.requestId) || result.requestType !== expectedType ||
    !STATES.has(result.state) || !(result.requestedAt instanceof Date) ||
    Number.isNaN(result.requestedAt.getTime())
  ) throw new TenantDataLifecycleRequestValidationError();
  return result;
};

export class TenantDataLifecycleService {
  constructor(private readonly repository: TenantDataLifecycleRequestRepository) {}

  async requestExport(
    context: RepositoryContext,
    input: { readonly requestId: string; readonly requestedAt: Date },
  ): Promise<TenantDataLifecycleRequestResult> {
    if (!validRequest(context, input)) {
      throw new TenantDataLifecycleRequestValidationError();
    }
    return validateResult(
      await this.repository.requestExport(context, input),
      "export",
    );
  }

  async requestDeletion(
    context: RepositoryContext,
    input: {
      readonly requestId: string;
      readonly requestedAt: Date;
      readonly confirmed: boolean;
    },
  ): Promise<TenantDataLifecycleRequestResult> {
    if (!validRequest(context, input) || input.confirmed !== true) {
      throw new TenantDataLifecycleRequestValidationError();
    }
    return validateResult(
      await this.repository.requestDeletion(context, {
        requestId: input.requestId,
        requestedAt: input.requestedAt,
        confirmed: true,
      }),
      "deletion",
    );
  }

  async get(
    context: RepositoryContext,
    requestId: string,
  ): Promise<TenantDataLifecycleRequestDetails | null> {
    if (!UUID.test(context.userId) || !UUID.test(context.tenantId) ||
        !UUID.test(requestId)) {
      throw new TenantDataLifecycleRequestValidationError();
    }
    return this.repository.get(context, requestId);
  }
}
