import type { CanonicalCase } from "./case-portfolio.js";
import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export interface PersistedCaseSource {
  readonly sourceId: string;
  readonly official: boolean;
  readonly collectedAt: Date;
}

export interface PersistedCaseRecord {
  readonly tenantId: string;
  readonly caseId: string;
  readonly cnjNumber: string;
  readonly tribunal: string;
  readonly identityStatus: "confirmed";
  readonly lastUpdatedAt: Date;
  readonly sources: readonly PersistedCaseSource[];
}

export interface PersistedCasePageRequest {
  readonly limit: number;
  readonly afterCaseId?: string;
}

export interface PersistedCasePage {
  readonly items: readonly PersistedCaseRecord[];
  readonly nextCursor: string | null;
}

export interface PersistedCasePortfolioRepository {
  list(
    context: RepositoryContext,
    page: PersistedCasePageRequest,
  ): Promise<PersistedCasePage>;
}

export interface PersonalCasePortfolioPage {
  readonly cases: readonly CanonicalCase[];
  readonly nextCursor: string | null;
}

export interface PersonalCasePortfolioService {
  list(
    providerSubject: string,
    page: PersistedCasePageRequest,
  ): Promise<PersonalCasePortfolioPage>;
}

export class PersistedCasePageValidationError extends Error {
  constructor() {
    super("Paginação da carteira inválida.");
    this.name = "PersistedCasePageValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validatePersistedCasePage = (
  page: PersistedCasePageRequest,
): void => {
  if (
    !Number.isInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > 100 ||
    (page.afterCaseId !== undefined &&
      !UUID_PATTERN.test(page.afterCaseId))
  ) {
    throw new PersistedCasePageValidationError();
  }
};

export class PersonalCasePortfolio implements PersonalCasePortfolioService {
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: PersistedCasePortfolioRepository,
  ) {}

  async list(
    providerSubject: string,
    page: PersistedCasePageRequest,
  ): Promise<PersonalCasePortfolioPage> {
    validatePersistedCasePage(page);
    const context = await this.contextResolver.resolve(providerSubject);
    const result = await this.repository.list(context, page);
    return {
      cases: result.items
        .filter((item) => item.tenantId === context.tenantId)
        .map((item): CanonicalCase => ({
          caseId: item.caseId,
          scope: { kind: "personal", userId: providerSubject },
          cnjNumber: item.cnjNumber,
          tribunal: item.tribunal,
          identityStatus: item.identityStatus,
          lastUpdatedAt: item.lastUpdatedAt.toISOString(),
          sources: item.sources.map((source) => ({
            sourceId: source.sourceId,
            official: source.official,
            collectedAt: source.collectedAt.toISOString(),
          })),
          events: [],
        })),
      nextCursor: result.nextCursor,
    };
  }
}
