import type {
  AuthenticatedPrincipal,
  TenantScope,
} from "../domain/access-control.js";

export interface Clock {
  now(): Date;
}

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly principal: AuthenticatedPrincipal;
  readonly tenantScope: TenantScope;
  readonly receivedAt: string;
}

export class RequestContextAccessDeniedError extends Error {
  constructor() {
    super("The requested organization is not an active membership.");
    this.name = "RequestContextAccessDeniedError";
  }
}

const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

export const createRequestContext = ({
  principal,
  requestedOrganizationId,
  suppliedCorrelationId,
  clock,
  createId,
}: {
  principal: AuthenticatedPrincipal;
  requestedOrganizationId?: string;
  suppliedCorrelationId?: string;
  clock: Clock;
  createId: () => string;
}): RequestContext => {
  const requestId = createId();
  let tenantScope: TenantScope = {
    kind: "personal",
    userId: principal.userId,
  };

  if (requestedOrganizationId) {
    const membership = principal.memberships.find(
      (candidate) =>
        candidate.active &&
        candidate.organizationId === requestedOrganizationId,
    );
    if (!membership) throw new RequestContextAccessDeniedError();
    tenantScope = {
      kind: "organization",
      organizationId: membership.organizationId,
    };
  }

  return {
    requestId,
    correlationId:
      suppliedCorrelationId && SAFE_CORRELATION_ID.test(suppliedCorrelationId)
        ? suppliedCorrelationId
        : requestId,
    principal,
    tenantScope,
    receivedAt: clock.now().toISOString(),
  };
};
