import {
  canAccessScope,
  scopesEqual,
  type AuthenticatedPrincipal,
  type TenantScope,
} from "../domain/access-control.js";

export type CaseIdentityStatus = "confirmed" | "possible_homonym";

export interface CaseSource {
  sourceId: string;
  official: boolean;
  collectedAt: string;
  officialIdentifier?: string;
}

export interface CaseEvent {
  eventId: string;
  occurredAt?: string;
  title: string;
  description?: string;
  sourceId: string;
}

export interface CanonicalCase {
  caseId: string;
  scope: TenantScope;
  cnjNumber: string;
  tribunal: string;
  organ?: string;
  className?: string;
  identityStatus: CaseIdentityStatus;
  lastUpdatedAt: string;
  sources: readonly CaseSource[];
  events: readonly CaseEvent[];
}

export interface CaseRepository {
  list(scope: TenantScope): Promise<readonly CanonicalCase[]>;
  findById(
    scope: TenantScope,
    caseId: string,
  ): Promise<CanonicalCase | undefined>;
}

export class PortfolioAccessDeniedError extends Error {
  constructor() {
    super("Acesso negado ao portfólio solicitado.");
    this.name = "PortfolioAccessDeniedError";
  }
}

export class PortfolioCaseNotFoundError extends Error {
  constructor() {
    super("Processo não encontrado.");
    this.name = "PortfolioCaseNotFoundError";
  }
}

export const listAuthorizedCases = async (
  principal: AuthenticatedPrincipal,
  scope: TenantScope,
  repository: CaseRepository,
): Promise<readonly CanonicalCase[]> => {
  if (!canAccessScope(principal, scope)) throw new PortfolioAccessDeniedError();

  const cases = await repository.list(scope);
  return cases.filter((candidate) => scopesEqual(candidate.scope, scope));
};

export const getAuthorizedCase = async (
  principal: AuthenticatedPrincipal,
  scope: TenantScope,
  caseId: string,
  repository: CaseRepository,
): Promise<CanonicalCase> => {
  if (!canAccessScope(principal, scope)) throw new PortfolioAccessDeniedError();

  const candidate = await repository.findById(scope, caseId);
  if (!candidate || !scopesEqual(candidate.scope, scope)) {
    throw new PortfolioCaseNotFoundError();
  }

  return candidate;
};
