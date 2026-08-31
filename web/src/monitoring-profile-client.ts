export type MonitoringProfileType = "name" | "cpf" | "cnpj";

export interface MonitoringProfile {
  readonly subjectId: string;
  readonly subjectType: MonitoringProfileType;
  readonly displayLabel: string;
  readonly status: "active" | "inactive" | "deleted";
  readonly version: number;
  readonly archivedAt: string | null;
  readonly processCount: number;
  readonly processSummary: readonly MonitoringProfileProcessSummary[];
}

export interface MonitoringProfileProcessSummary {
  readonly cnjNumber: string;
  readonly tribunal: string;
  readonly lastActivityAt: string;
}

export interface MonitoringProfileCommand {
  readonly type: MonitoringProfileType;
  readonly value: string;
}

export class SafeMonitoringProfileError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SafeMonitoringProfileError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_KEYS = new Set([
  "subjectId",
  "subjectType",
  "displayLabel",
  "status",
  "version",
  "archivedAt",
  "processCount",
  "processSummary",
]);
const MAX_PROFILE_PAGES = 100;

const invalidResponse = () =>
  new SafeMonitoringProfileError(
    "INVALID_RESPONSE",
    "O servidor retornou uma resposta inesperada.",
  );

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Record<string, unknown>;
};

const parseProcessSummary = (
  value: unknown,
): readonly MonitoringProfileProcessSummary[] => {
  if (!Array.isArray(value) || value.length > 3) throw invalidResponse();
  return value.map((item) => {
    const record = asRecord(item);
    if (
      Object.keys(record).length !== 3 ||
      typeof record.cnjNumber !== "string" ||
      !/^[0-9]{7}-[0-9]{2}\.[0-9]{4}\.[0-9]\.[0-9]{2}\.[0-9]{4}$/u.test(
        record.cnjNumber,
      ) ||
      typeof record.tribunal !== "string" ||
      !/^[A-Z][A-Z0-9-]{1,19}$/u.test(record.tribunal) ||
      typeof record.lastActivityAt !== "string" ||
      Number.isNaN(Date.parse(record.lastActivityAt))
    ) {
      throw invalidResponse();
    }
    return {
      cnjNumber: record.cnjNumber,
      tribunal: record.tribunal,
      lastActivityAt: record.lastActivityAt,
    };
  });
};

const parseProfile = (value: unknown): MonitoringProfile => {
  const record = asRecord(value);
  if (
    Object.keys(record).some((key) => !SUBJECT_KEYS.has(key)) ||
    Object.keys(record).length !== SUBJECT_KEYS.size ||
    typeof record.subjectId !== "string" ||
    !UUID_PATTERN.test(record.subjectId) ||
    !["name", "cpf", "cnpj"].includes(String(record.subjectType)) ||
    typeof record.displayLabel !== "string" ||
    record.displayLabel.length < 1 ||
    record.displayLabel.length > 80 ||
    !["active", "inactive", "deleted"].includes(String(record.status)) ||
    !Number.isSafeInteger(record.version) ||
    Number(record.version) < 1 ||
    (record.archivedAt !== null &&
      (typeof record.archivedAt !== "string" ||
        Number.isNaN(Date.parse(record.archivedAt)))) ||
    !Number.isSafeInteger(record.processCount) ||
    Number(record.processCount) < 0
  ) {
    throw invalidResponse();
  }
  return {
    subjectId: record.subjectId,
    subjectType: record.subjectType as MonitoringProfileType,
    displayLabel: record.displayLabel,
    status: record.status as MonitoringProfile["status"],
    version: Number(record.version),
    archivedAt: record.archivedAt,
    processCount: Number(record.processCount),
    processSummary: parseProcessSummary(record.processSummary),
  };
};

const throwApiError = (value: unknown): never => {
  const fallback = new SafeMonitoringProfileError(
    "MONITORING_PROFILE_FAILED",
    "Não foi possível atualizar seus perfis monitorados.",
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fallback;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    record.code.length < 1 ||
    record.code.length > 80 ||
    typeof record.message !== "string" ||
    record.message.length < 1 ||
    record.message.length > 240
  ) {
    throw fallback;
  }
  throw new SafeMonitoringProfileError(record.code, record.message);
};

const authenticatedHeaders = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
});

interface MonitoringProfilePage {
  readonly items: readonly MonitoringProfile[];
  readonly nextCursor: string | null;
}

const parsePage = (value: unknown): MonitoringProfilePage => {
  const record = asRecord(value);
  if (
    Object.keys(record).length !== 2 ||
    !Array.isArray(record.items) ||
    (record.nextCursor !== null &&
      (typeof record.nextCursor !== "string" ||
        !UUID_PATTERN.test(record.nextCursor)))
  ) {
    throw invalidResponse();
  }
  return {
    items: record.items.map(parseProfile),
    nextCursor: record.nextCursor,
  };
};

export const listMonitoringProfiles = async (
  fetcher: typeof fetch,
  token: string,
): Promise<readonly MonitoringProfile[]> => {
  const profiles: MonitoringProfile[] = [];
  const seenProfileIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_PROFILE_PAGES; pageNumber += 1) {
    const after = cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`;
    const response = await fetcher(
      `/api/v1/monitoring/subjects?limit=100${after}`,
      { headers: authenticatedHeaders(token) },
    );
    const body = await readJson(response);
    if (!response.ok) throwApiError(body);
    const page = parsePage(body);

    for (const profile of page.items) {
      if (seenProfileIds.has(profile.subjectId)) throw invalidResponse();
      seenProfileIds.add(profile.subjectId);
      profiles.push(profile);
    }

    if (page.nextCursor === null) return profiles;
    if (seenCursors.has(page.nextCursor)) throw invalidResponse();
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw invalidResponse();
};

export const createMonitoringProfile = async (
  fetcher: typeof fetch,
  token: string,
  command: MonitoringProfileCommand,
): Promise<MonitoringProfile> => {
  const response = await fetcher("/api/v1/monitoring/subjects", {
    method: "POST",
    headers: {
      ...authenticatedHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (Object.keys(record).length !== 1) throw invalidResponse();
  return parseProfile(record.subject);
};

export const archiveMonitoringProfile = async (
  fetcher: typeof fetch,
  token: string,
  profile: MonitoringProfile,
): Promise<MonitoringProfile> => {
  const response = await fetcher(
    `/api/v1/monitoring/subjects/${profile.subjectId}`,
    {
      method: "DELETE",
      headers: {
        ...authenticatedHeaders(token),
        "if-match": `"${profile.version}"`,
      },
    },
  );
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (Object.keys(record).length !== 1) throw invalidResponse();
  return parseProfile(record.subject);
};
