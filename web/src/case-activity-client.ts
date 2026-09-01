export type AlertStatus = "unread" | "read";
export type AlertStatusFilter = AlertStatus | "all";

export interface CaseAlert {
  readonly alertId: string;
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly tenantCaseId: string;
  readonly caseId: string;
  readonly caseEventId: string;
  readonly cnjNumber: string;
  readonly tribunal: string;
  readonly alertType: "case_discovered";
  readonly status: AlertStatus;
  readonly matchStatus: "unverified";
  readonly sourceOccurredAt: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface CaseTimelineEventSource {
  readonly sourceId: string;
  readonly official: boolean;
  readonly collectedAt: string;
}

export interface CaseTimelineEvent {
  readonly eventId: string;
  readonly caseId: string;
  readonly eventType: "publication";
  readonly occurredAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly sources: readonly CaseTimelineEventSource[];
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export class SafeCaseActivityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SafeCaseActivityError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const CURSOR = /^[A-Za-z0-9_-]{8,512}$/;
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const ALERT_KEYS = new Set([
  "alertId", "subjectId", "subjectLabel", "tenantCaseId", "caseId",
  "caseEventId", "cnjNumber", "tribunal", "alertType", "status",
  "matchStatus", "sourceOccurredAt", "createdAt", "readAt",
]);
const EVENT_KEYS = new Set([
  "eventId", "caseId", "eventType", "occurredAt", "title", "description",
  "sources",
]);
const SOURCE_KEYS = new Set(["sourceId", "official", "collectedAt"]);

const invalidResponse = () =>
  new SafeCaseActivityError(
    "INVALID_RESPONSE",
    "O servidor retornou dados de acompanhamento inesperados.",
  );

const invalidRequest = () =>
  new SafeCaseActivityError(
    "INVALID_REQUEST",
    "Não foi possível montar a consulta de acompanhamento.",
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

const parseAlert = (value: unknown): CaseAlert => {
  const record = asRecord(value);
  if (
    !hasExactKeys(record, ALERT_KEYS) ||
    typeof record.alertId !== "string" || !UUID.test(record.alertId) ||
    typeof record.subjectId !== "string" || !UUID.test(record.subjectId) ||
    typeof record.subjectLabel !== "string" ||
      record.subjectLabel.length < 1 || record.subjectLabel.length > 80 ||
    typeof record.tenantCaseId !== "string" || !UUID.test(record.tenantCaseId) ||
    typeof record.caseId !== "string" || !UUID.test(record.caseId) ||
    typeof record.caseEventId !== "string" || !UUID.test(record.caseEventId) ||
    typeof record.cnjNumber !== "string" || !CNJ.test(record.cnjNumber) ||
    typeof record.tribunal !== "string" ||
      record.tribunal.length < 1 || record.tribunal.length > 32 ||
    record.alertType !== "case_discovered" ||
    !["unread", "read"].includes(String(record.status)) ||
    record.matchStatus !== "unverified" ||
    !isDate(record.sourceOccurredAt) ||
    !isDate(record.createdAt) ||
    (record.readAt !== null && !isDate(record.readAt)) ||
    (record.status === "unread" && record.readAt !== null) ||
    (record.status === "read" && record.readAt === null)
  ) throw invalidResponse();
  return record as unknown as CaseAlert;
};

const parseSource = (value: unknown): CaseTimelineEventSource => {
  const record = asRecord(value);
  if (
    !hasExactKeys(record, SOURCE_KEYS) ||
    typeof record.sourceId !== "string" || !SOURCE_ID.test(record.sourceId) ||
    typeof record.official !== "boolean" ||
    !isDate(record.collectedAt)
  ) throw invalidResponse();
  return record as unknown as CaseTimelineEventSource;
};

const parseEvent = (value: unknown, caseId: string): CaseTimelineEvent => {
  const record = asRecord(value);
  if (
    !hasExactKeys(record, EVENT_KEYS) ||
    typeof record.eventId !== "string" || !UUID.test(record.eventId) ||
    record.caseId !== caseId ||
    record.eventType !== "publication" ||
    !isDate(record.occurredAt) ||
    typeof record.title !== "string" ||
      record.title.length < 1 || record.title.length > 200 ||
    (record.description !== null &&
      (typeof record.description !== "string" || record.description.length > 500)) ||
    !Array.isArray(record.sources) ||
    record.sources.length < 1 || record.sources.length > 16
  ) throw invalidResponse();
  const sources = record.sources.map(parseSource);
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw invalidResponse();
  }
  return {
    eventId: record.eventId,
    caseId: record.caseId,
    eventType: record.eventType,
    occurredAt: record.occurredAt,
    title: record.title,
    description: record.description,
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
  const fallback = new SafeCaseActivityError(
    "CASE_ACTIVITY_FAILED",
    "Não foi possível carregar o acompanhamento.",
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fallback;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== "string" || record.code.length < 1 || record.code.length > 80 ||
    typeof record.message !== "string" ||
      record.message.length < 1 || record.message.length > 240
  ) throw fallback;
  throw new SafeCaseActivityError(record.code, record.message);
};

const parseCursor = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !CURSOR.test(value)) throw invalidResponse();
  return value;
};

const headers = (token: string) => ({ authorization: `Bearer ${token}` });

const assertPageRequest = (
  limit: number,
  cursor: string | undefined,
): void => {
  if (
    !Number.isInteger(limit) || limit < 1 || limit > 100 ||
    (cursor !== undefined && !CURSOR.test(cursor))
  ) throw invalidRequest();
};

export const listAlertsPage = async (
  fetcher: typeof fetch,
  token: string,
  request: {
    readonly limit: number;
    readonly status: AlertStatusFilter;
    readonly cursor?: string;
  },
): Promise<CursorPage<CaseAlert>> => {
  assertPageRequest(request.limit, request.cursor);
  if (!["all", "unread", "read"].includes(request.status)) throw invalidRequest();
  const cursor = request.cursor
    ? `&cursor=${encodeURIComponent(request.cursor)}`
    : "";
  const response = await fetcher(
    `/api/v1/alerts?limit=${request.limit}&status=${request.status}${cursor}`,
    { headers: headers(token) },
  );
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (!hasExactKeys(record, new Set(["items", "nextCursor"])) ||
      !Array.isArray(record.items)) throw invalidResponse();
  const items = record.items.map(parseAlert);
  if (new Set(items.map((item) => item.alertId)).size !== items.length) {
    throw invalidResponse();
  }
  return { items, nextCursor: parseCursor(record.nextCursor) };
};

export const markAlertRead = async (
  fetcher: typeof fetch,
  token: string,
  alertId: string,
): Promise<CaseAlert> => {
  if (!UUID.test(alertId)) throw invalidRequest();
  const response = await fetcher(`/api/v1/alerts/${alertId}/read`, {
    method: "PATCH",
    headers: headers(token),
  });
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (!hasExactKeys(record, new Set(["alert"]))) throw invalidResponse();
  const parsed = parseAlert(record.alert);
  if (parsed.alertId !== alertId) throw invalidResponse();
  return parsed;
};

export const listCaseTimelinePage = async (
  fetcher: typeof fetch,
  token: string,
  caseId: string,
  request: { readonly limit: number; readonly cursor?: string },
): Promise<CursorPage<CaseTimelineEvent>> => {
  if (!UUID.test(caseId)) throw invalidRequest();
  assertPageRequest(request.limit, request.cursor);
  const cursor = request.cursor
    ? `&cursor=${encodeURIComponent(request.cursor)}`
    : "";
  const response = await fetcher(
    `/api/v1/cases/${caseId}/events?limit=${request.limit}${cursor}`,
    { headers: headers(token) },
  );
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (!hasExactKeys(record, new Set(["events", "page"])) ||
      !Array.isArray(record.events)) throw invalidResponse();
  const page = asRecord(record.page);
  if (!hasExactKeys(page, new Set(["nextCursor"]))) throw invalidResponse();
  const items = record.events.map((item) => parseEvent(item, caseId));
  if (new Set(items.map((item) => item.eventId)).size !== items.length) {
    throw invalidResponse();
  }
  return { items, nextCursor: parseCursor(page.nextCursor) };
};
