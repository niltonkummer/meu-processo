import type {
  PersistedCasePage,
  PersistedCasePageRequest,
  PersistedCasePortfolioRepository,
  PersistedCaseRecord,
} from "../application/persisted-case-portfolio.js";
import { validatePersistedCasePage } from "../application/persisted-case-portfolio.js";
import type { RepositoryContext } from "../application/foundation-repository.js";

const copyRecord = (record: PersistedCaseRecord): PersistedCaseRecord => ({
  ...record,
  lastUpdatedAt: new Date(record.lastUpdatedAt),
  sources: record.sources.map((source) => ({
    ...source,
    collectedAt: new Date(source.collectedAt),
  })),
});

export class MemoryPersistedCasePortfolioRepository
  implements PersistedCasePortfolioRepository
{
  private readonly records: readonly PersistedCaseRecord[];

  constructor(seed: readonly PersistedCaseRecord[] = []) {
    this.records = seed.map(copyRecord);
  }

  async list(
    context: RepositoryContext,
    page: PersistedCasePageRequest,
  ): Promise<PersistedCasePage> {
    await Promise.resolve();
    validatePersistedCasePage(page);
    const selected = this.records
      .filter(
        (record) =>
          record.tenantId === context.tenantId &&
          (!page.afterCaseId || record.caseId > page.afterCaseId),
      )
      .sort((left, right) => left.caseId.localeCompare(right.caseId))
      .slice(0, page.limit + 1);
    const hasNextPage = selected.length > page.limit;
    const items = selected.slice(0, page.limit).map(copyRecord);
    return {
      items,
      nextCursor: hasNextPage ? (items.at(-1)?.caseId ?? null) : null,
    };
  }
}
