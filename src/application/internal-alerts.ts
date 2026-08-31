import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export type AlertStatus = "unread" | "read";
export type AlertStatusFilter = AlertStatus | "all";

export interface PersistedAlert {
  readonly tenantId: string;
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
  readonly sourceOccurredAt: Date;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

export interface AlertCursor {
  readonly createdAt: Date;
  readonly alertId: string;
}

export interface AlertRepositoryPage {
  readonly limit: number;
  readonly status: AlertStatusFilter;
  readonly after?: AlertCursor;
}

export interface AlertRepository {
  list(
    context: RepositoryContext,
    page: AlertRepositoryPage,
  ): Promise<{ readonly items: readonly PersistedAlert[]; readonly next: AlertCursor | null }>;
  markRead(
    context: RepositoryContext,
    alertId: string,
    readAt: Date,
  ): Promise<PersistedAlert | null>;
}

export interface PersonalAlert {
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

export interface AlertPageRequest {
  readonly limit: number;
  readonly status?: AlertStatusFilter;
  readonly cursor?: string;
}

export interface PersonalAlertsService {
  list(
    providerSubject: string,
    request: AlertPageRequest,
  ): Promise<{ readonly items: readonly PersonalAlert[]; readonly nextCursor: string | null }>;
  markRead(providerSubject: string, alertId: string): Promise<PersonalAlert>;
}

export class AlertPageValidationError extends Error {
  constructor() {
    super("Paginação de alertas inválida.");
    this.name = "AlertPageValidationError";
  }
}

export class AlertNotFoundError extends Error {
  constructor() {
    super("Alerta não encontrado.");
    this.name = "AlertNotFoundError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{8,512}$/;

const decodeCursor = (cursor: string): AlertCursor => {
  try {
    if (!CURSOR.test(cursor)) throw new AlertPageValidationError();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new AlertPageValidationError();
    }
    const record = value as Record<string, unknown>;
    const createdAt = new Date(String(record.at));
    if (
      Object.keys(record).length !== 3 ||
      record.v !== 1 ||
      typeof record.at !== "string" ||
      Number.isNaN(createdAt.getTime()) ||
      typeof record.id !== "string" ||
      !UUID.test(record.id)
    ) {
      throw new AlertPageValidationError();
    }
    return { createdAt, alertId: record.id };
  } catch (error) {
    if (error instanceof AlertPageValidationError) throw error;
    throw new AlertPageValidationError();
  }
};

const encodeCursor = (cursor: AlertCursor): string =>
  Buffer.from(
    JSON.stringify({ v: 1, at: cursor.createdAt.toISOString(), id: cursor.alertId }),
    "utf8",
  ).toString("base64url");

const toPersonalAlert = (alert: PersistedAlert): PersonalAlert => ({
  alertId: alert.alertId,
  subjectId: alert.subjectId,
  subjectLabel: alert.subjectLabel,
  tenantCaseId: alert.tenantCaseId,
  caseId: alert.caseId,
  caseEventId: alert.caseEventId,
  cnjNumber: alert.cnjNumber,
  tribunal: alert.tribunal,
  alertType: alert.alertType,
  status: alert.status,
  matchStatus: alert.matchStatus,
  sourceOccurredAt: alert.sourceOccurredAt.toISOString(),
  createdAt: alert.createdAt.toISOString(),
  readAt: alert.readAt?.toISOString() ?? null,
});

export class PersonalAlerts implements PersonalAlertsService {
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: AlertRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    providerSubject: string,
    request: AlertPageRequest,
  ): Promise<{ readonly items: readonly PersonalAlert[]; readonly nextCursor: string | null }> {
    const status = request.status ?? "all";
    if (
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 100 ||
      !["all", "unread", "read"].includes(status)
    ) {
      throw new AlertPageValidationError();
    }
    const context = await this.contextResolver.resolve(providerSubject);
    const result = await this.repository.list(context, {
      limit: request.limit,
      status,
      ...(request.cursor ? { after: decodeCursor(request.cursor) } : {}),
    });
    if (result.items.some((item) => item.tenantId !== context.tenantId)) {
      throw new AlertNotFoundError();
    }
    return {
      items: result.items.map(toPersonalAlert),
      nextCursor: result.next ? encodeCursor(result.next) : null,
    };
  }

  async markRead(providerSubject: string, alertId: string): Promise<PersonalAlert> {
    const readAt = this.now();
    if (!UUID.test(alertId) || Number.isNaN(readAt.getTime())) {
      throw new AlertPageValidationError();
    }
    const context = await this.contextResolver.resolve(providerSubject);
    const result = await this.repository.markRead(context, alertId, readAt);
    if (!result || result.tenantId !== context.tenantId) {
      throw new AlertNotFoundError();
    }
    return toPersonalAlert(result);
  }
}
