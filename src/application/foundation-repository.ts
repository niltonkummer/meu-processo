export type SubjectType = "name" | "cpf" | "cnpj";
export type MonitoringTargetType = "name" | "cpf" | "cnpj" | "cnj" | "oab";

export interface RepositoryContext {
  readonly userId: string;
  readonly tenantId: string;
}

export interface PersonalTenantInput extends RepositoryContext {
  readonly providerSubject: string;
}

export interface MonitoredSubjectInput {
  readonly subjectId: string;
  readonly subjectType: SubjectType;
  readonly displayLabel: string;
  readonly protectedReference: string;
  readonly encryptedValue: string;
  readonly keyVersion: string;
}

export interface ScheduledMonitoringProfileInput extends MonitoredSubjectInput {
  readonly targetId: string;
  readonly stateId: string;
  readonly eventId: string;
  readonly sourceCode: string;
  readonly scheduledAt: Date;
}

export interface MonitoredSubject {
  readonly subjectId: string;
  readonly subjectType: SubjectType;
  readonly displayLabel: string;
  readonly tenantId: string;
  readonly status: "active" | "inactive" | "deleted";
  readonly version: number;
  readonly archivedAt: Date | null;
}

export interface MonitoredSubjectUpdate {
  readonly subjectId: string;
  readonly expectedVersion: number;
  readonly displayLabel: string;
}

export interface MonitoringTargetInput {
  readonly targetId: string;
  readonly targetType: MonitoringTargetType;
  readonly displayLabel: string;
  readonly protectedReference: string;
  readonly jurisdiction: string;
}

export interface MonitoringTarget extends MonitoringTargetInput {
  readonly tenantId: string;
  readonly status: "active" | "inactive" | "deleted";
  readonly nextCheckAt: Date | null;
  readonly version: number;
  readonly archivedAt: Date | null;
}

export interface MonitoringTargetUpdate {
  readonly targetId: string;
  readonly expectedVersion: number;
  readonly displayLabel: string;
}

export interface SubjectPageRequest {
  readonly limit: number;
  readonly afterSubjectId?: string;
  readonly includeInactive?: boolean;
}

export interface SubjectPage {
  readonly items: readonly MonitoredSubject[];
  readonly nextCursor: string | null;
}

export interface TargetPageRequest {
  readonly limit: number;
  readonly afterTargetId?: string;
  readonly includeInactive?: boolean;
}

export interface TargetPage {
  readonly items: readonly MonitoringTarget[];
  readonly nextCursor: string | null;
}

export type TargetSourceStatus =
  | "pending"
  | "ready"
  | "running"
  | "backoff"
  | "disabled"
  | "archived";

export interface TargetSourceStateInput {
  readonly stateId: string;
  readonly targetId: string;
  readonly sourceId: string;
}

export interface TargetSourceState extends TargetSourceStateInput {
  readonly tenantId: string;
  readonly status: TargetSourceStatus;
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly consecutiveFailures: number;
  readonly version: number;
}

export interface TargetSourceStateUpdate {
  readonly stateId: string;
  readonly expectedVersion: number;
  readonly status: TargetSourceStatus;
  readonly attemptedAt: Date;
  readonly succeededAt?: Date;
  readonly nextAttemptAt: Date | null;
  readonly consecutiveFailures: number;
}

export interface FoundationRepository {
  provisionPersonalTenant(input: PersonalTenantInput): Promise<void>;
  createMonitoredSubject(
    context: RepositoryContext,
    input: MonitoredSubjectInput,
  ): Promise<MonitoredSubject>;
  createScheduledMonitoringProfile(
    context: RepositoryContext,
    input: ScheduledMonitoringProfileInput,
  ): Promise<MonitoredSubject>;
  updateMonitoredSubject(
    context: RepositoryContext,
    input: MonitoredSubjectUpdate,
  ): Promise<MonitoredSubject>;
  archiveMonitoredSubject(
    context: RepositoryContext,
    subjectId: string,
    expectedVersion: number,
  ): Promise<MonitoredSubject>;
  listMonitoredSubjects(
    context: RepositoryContext,
    page: SubjectPageRequest,
  ): Promise<SubjectPage>;
  createMonitoringTarget(
    context: RepositoryContext,
    input: MonitoringTargetInput,
  ): Promise<void>;
  updateMonitoringTarget(
    context: RepositoryContext,
    input: MonitoringTargetUpdate,
  ): Promise<MonitoringTarget>;
  archiveMonitoringTarget(
    context: RepositoryContext,
    targetId: string,
    expectedVersion: number,
  ): Promise<MonitoringTarget>;
  listMonitoringTargets(
    context: RepositoryContext,
    page: TargetPageRequest,
  ): Promise<TargetPage>;
  linkSubjectTarget(
    context: RepositoryContext,
    subjectId: string,
    targetId: string,
  ): Promise<void>;
  createTargetSourceState(
    context: RepositoryContext,
    input: TargetSourceStateInput,
  ): Promise<TargetSourceState>;
  updateTargetSourceState(
    context: RepositoryContext,
    input: TargetSourceStateUpdate,
  ): Promise<TargetSourceState>;
}

export class RepositoryAccessDeniedError extends Error {
  constructor() {
    super("Repository context is not an active tenant membership.");
    this.name = "RepositoryAccessDeniedError";
  }
}

export class RepositoryConflictError extends Error {
  constructor() {
    super("Repository constraint conflict.");
    this.name = "RepositoryConflictError";
  }
}

export class RepositoryValidationError extends Error {
  constructor() {
    super("Repository request is invalid.");
    this.name = "RepositoryValidationError";
  }
}

export const validatePageLimit = (limit: number): void => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RepositoryValidationError();
  }
};
