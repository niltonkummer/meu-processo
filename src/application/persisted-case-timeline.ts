import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export interface PersistedCaseEventSource {
  readonly sourceId: string;
  readonly official: boolean;
  readonly collectedAt: Date;
}

export interface PersistedCaseEvent {
  readonly tenantId: string;
  readonly caseEventId: string;
  readonly caseId: string;
  readonly eventType: "publication";
  readonly occurredAt: Date;
  readonly title: string;
  readonly plainTextExcerpt: string | null;
  readonly sources: readonly PersistedCaseEventSource[];
}

export interface CaseTimelineCursor {
  readonly occurredAt: Date;
  readonly caseEventId: string;
}

export interface CaseTimelineRepositoryPage {
  readonly limit: number;
  readonly after?: CaseTimelineCursor;
}

export interface PersistedCaseTimelineRepository {
  list(
    context: RepositoryContext,
    caseId: string,
    page: CaseTimelineRepositoryPage,
  ): Promise<{
    readonly caseFound: boolean;
    readonly items: readonly PersistedCaseEvent[];
    readonly next: CaseTimelineCursor | null;
  }>;
}

export interface PersonalCaseTimelineEvent {
  readonly eventId: string;
  readonly caseId: string;
  readonly eventType: "publication";
  readonly occurredAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly official: boolean;
    readonly collectedAt: string;
  }[];
}

export interface PersonalCaseTimelineService {
  list(
    providerSubject: string,
    caseId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly PersonalCaseTimelineEvent[];
    readonly nextCursor: string | null;
  }>;
}

export class CaseTimelinePageValidationError extends Error {
  constructor() {
    super("Paginação da linha do tempo inválida.");
    this.name = "CaseTimelinePageValidationError";
  }
}

export class CaseTimelineNotFoundError extends Error {
  constructor() {
    super("Processo não encontrado.");
    this.name = "CaseTimelineNotFoundError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{8,512}$/;

const decodeCursor = (cursor: string): CaseTimelineCursor => {
  try {
    if (!CURSOR.test(cursor)) throw new CaseTimelinePageValidationError();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CaseTimelinePageValidationError();
    }
    const record = value as Record<string, unknown>;
    const occurredAt = new Date(String(record.at));
    if (
      Object.keys(record).length !== 3 ||
      record.v !== 1 ||
      typeof record.at !== "string" ||
      Number.isNaN(occurredAt.getTime()) ||
      typeof record.id !== "string" ||
      !UUID.test(record.id)
    ) throw new CaseTimelinePageValidationError();
    return { occurredAt, caseEventId: record.id };
  } catch (error) {
    if (error instanceof CaseTimelinePageValidationError) throw error;
    throw new CaseTimelinePageValidationError();
  }
};

const encodeCursor = (cursor: CaseTimelineCursor): string =>
  Buffer.from(JSON.stringify({
    v: 1,
    at: cursor.occurredAt.toISOString(),
    id: cursor.caseEventId,
  }), "utf8").toString("base64url");

export class PersonalCaseTimeline implements PersonalCaseTimelineService {
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: PersistedCaseTimelineRepository,
  ) {}

  async list(
    providerSubject: string,
    caseId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ) {
    if (!UUID.test(caseId) || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
      throw new CaseTimelinePageValidationError();
    }
    const context = await this.contextResolver.resolve(providerSubject);
    const result = await this.repository.list(context, caseId, {
      limit: page.limit,
      ...(page.cursor ? { after: decodeCursor(page.cursor) } : {}),
    });
    if (!result.caseFound || result.items.some((item) => item.tenantId !== context.tenantId)) {
      throw new CaseTimelineNotFoundError();
    }
    return {
      items: result.items.map((item) => ({
        eventId: item.caseEventId,
        caseId: item.caseId,
        eventType: item.eventType,
        occurredAt: item.occurredAt.toISOString(),
        title: item.title,
        description: item.plainTextExcerpt,
        sources: item.sources.map((source) => ({
          sourceId: source.sourceId,
          official: source.official,
          collectedAt: source.collectedAt.toISOString(),
        })),
      })),
      nextCursor: result.next ? encodeCursor(result.next) : null,
    };
  }
}

