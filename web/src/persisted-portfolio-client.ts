export type PersistedCaseIdentityStatus = "confirmed" | "possible_homonym";

export interface PersistedPortfolioSource {
  readonly sourceId: string;
  readonly official: boolean;
  readonly collectedAt: string;
}

export interface PersistedPortfolioCase {
  readonly caseId: string;
  readonly cnjNumber: string;
  readonly tribunal: string;
  readonly identityStatus: PersistedCaseIdentityStatus;
  readonly lastUpdatedAt: string;
  readonly sources: readonly PersistedPortfolioSource[];
}

export interface PersistedPortfolioPage {
  readonly items: readonly PersistedPortfolioCase[];
  readonly nextCursor: string | null;
}

export class SafePersistedPortfolioError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SafePersistedPortfolioError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const CASE_KEYS = new Set([
  "caseId", "cnjNumber", "tribunal", "identityStatus", "lastUpdatedAt",
  "sources",
]);
const SOURCE_KEYS = new Set(["sourceId", "official", "collectedAt"]);

const invalidResponse = () => new SafePersistedPortfolioError(
  "INVALID_RESPONSE",
  "O servidor retornou dados inesperados da carteira.",
);

const invalidRequest = () => new SafePersistedPortfolioError(
  "INVALID_REQUEST",
  "Não foi possível montar a consulta da carteira.",
);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Record<string, unknown>;
};

const hasExactKeys = (record: Record<string, unknown>, keys: Set<string>) =>
  Object.keys(record).length === keys.size &&
  Object.keys(record).every((key) => keys.has(key));

const isDate = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const parseSource = (value: unknown): PersistedPortfolioSource => {
  const record = asRecord(value);
  if (
    !hasExactKeys(record, SOURCE_KEYS) ||
    typeof record.sourceId !== "string" || !SOURCE_ID.test(record.sourceId) ||
    typeof record.official !== "boolean" ||
    !isDate(record.collectedAt)
  ) throw invalidResponse();
  return record as unknown as PersistedPortfolioSource;
};

const parseCase = (value: unknown): PersistedPortfolioCase => {
  const record = asRecord(value);
  if (
    !hasExactKeys(record, CASE_KEYS) ||
    typeof record.caseId !== "string" || !UUID.test(record.caseId) ||
    typeof record.cnjNumber !== "string" || !CNJ.test(record.cnjNumber) ||
    typeof record.tribunal !== "string" ||
      record.tribunal.length < 1 || record.tribunal.length > 32 ||
    !["confirmed", "possible_homonym"].includes(String(record.identityStatus)) ||
    !isDate(record.lastUpdatedAt) ||
    !Array.isArray(record.sources) || record.sources.length > 16
  ) throw invalidResponse();
  const sources = record.sources.map(parseSource);
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw invalidResponse();
  }
  return {
    caseId: record.caseId,
    cnjNumber: record.cnjNumber,
    tribunal: record.tribunal,
    identityStatus: record.identityStatus as PersistedCaseIdentityStatus,
    lastUpdatedAt: record.lastUpdatedAt,
    sources,
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
};

const throwApiError = (value: unknown): never => {
  const fallback = new SafePersistedPortfolioError(
    "CASE_PORTFOLIO_FAILED",
    "Não foi possível carregar a carteira de processos.",
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fallback;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
      record.code.length < 1 || record.code.length > 80 ||
    typeof record.message !== "string" ||
      record.message.length < 1 || record.message.length > 240
  ) throw fallback;
  throw new SafePersistedPortfolioError(record.code, record.message);
};

export const listPersistedCasesPage = async (
  fetcher: typeof fetch,
  token: string,
  request: { readonly limit: number; readonly afterCaseId?: string },
): Promise<PersistedPortfolioPage> => {
  if (
    !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100 ||
    (request.afterCaseId !== undefined && !UUID.test(request.afterCaseId))
  ) throw invalidRequest();
  const after = request.afterCaseId
    ? `&after=${encodeURIComponent(request.afterCaseId)}`
    : "";
  const response = await fetcher(
    `/api/v1/cases?limit=${request.limit}${after}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (!hasExactKeys(record, new Set(["cases", "page"])) ||
      !Array.isArray(record.cases)) throw invalidResponse();
  const page = asRecord(record.page);
  if (!hasExactKeys(page, new Set(["nextCursor"])) ||
      (page.nextCursor !== null &&
        (typeof page.nextCursor !== "string" || !UUID.test(page.nextCursor)))) {
    throw invalidResponse();
  }
  const items = record.cases.map(parseCase);
  if (new Set(items.map((item) => item.caseId)).size !== items.length) {
    throw invalidResponse();
  }
  return { items, nextCursor: page.nextCursor };
};
