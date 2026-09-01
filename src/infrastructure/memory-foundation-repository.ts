import {
  type FoundationRepository,
  type MonitoredSubject,
  type MonitoredSubjectInput,
  type MonitoredSubjectUpdate,
  type MonitoringTarget,
  type MonitoringTargetInput,
  type MonitoringTargetUpdate,
  type PersonalTenantInput,
  RepositoryAccessDeniedError,
  RepositoryConflictError,
  type RepositoryContext,
  type ScheduledMonitoringProfileInput,
  type SubjectPage,
  type SubjectPageRequest,
  type TargetPage,
  type TargetPageRequest,
  type TargetSourceState,
  type TargetSourceStateInput,
  type TargetSourceStateUpdate,
  validatePageLimit,
} from "../application/foundation-repository.js";

interface PersonalTenantState {
  readonly ownerUserId: string;
  readonly providerSubject: string;
}

interface StoredMonitoredSubject extends MonitoredSubject {
  readonly protectedReference: string;
  readonly encryptedValue: string;
  readonly keyVersion: string;
}

const toMonitoredSubject = (
  subject: StoredMonitoredSubject,
): MonitoredSubject => ({
  tenantId: subject.tenantId,
  subjectId: subject.subjectId,
  subjectType: subject.subjectType,
  displayLabel: subject.displayLabel,
  status: subject.status,
  version: subject.version,
  archivedAt: subject.archivedAt,
  processCount: subject.processCount,
  processSummary: subject.processSummary,
});

export class MemoryFoundationRepository implements FoundationRepository {
  private readonly tenants = new Map<string, PersonalTenantState>();
  private readonly subjects = new Map<
    string,
    Map<string, StoredMonitoredSubject>
  >();
  private readonly targets = new Map<string, Map<string, MonitoringTarget>>();
  private readonly sourceStates = new Map<
    string,
    Map<string, TargetSourceState>
  >();
  private readonly links = new Set<string>();
  private readonly scheduledProfiles = new Map<
    string,
    {
      readonly targetId: string;
      readonly stateId: string;
      readonly sourceCode: string;
      readonly outboxEventId: string;
    }
  >();
  private readonly outboxEvents = new Map<string, string>();

  provisionPersonalTenant(input: PersonalTenantInput): Promise<void> {
    const existing = this.tenants.get(input.tenantId);
    if (
      existing &&
      (existing.ownerUserId !== input.userId ||
        existing.providerSubject !== input.providerSubject)
    ) {
      throw new RepositoryConflictError();
    }
    if (!existing) {
      this.tenants.set(input.tenantId, {
        ownerUserId: input.userId,
        providerSubject: input.providerSubject,
      });
    }
    return Promise.resolve();
  }

  createMonitoredSubject(
    context: RepositoryContext,
    input: MonitoredSubjectInput,
  ): Promise<MonitoredSubject> {
    this.assertMembership(context);
    const subjects =
      this.subjects.get(context.tenantId) ??
      new Map<string, StoredMonitoredSubject>();
    const existing = subjects.get(input.subjectId);
    if (
      existing &&
      (existing.subjectType !== input.subjectType ||
        existing.displayLabel !== input.displayLabel ||
        existing.protectedReference !== input.protectedReference ||
        existing.encryptedValue !== input.encryptedValue ||
        existing.keyVersion !== input.keyVersion)
    ) {
      throw new RepositoryConflictError();
    }
    if (!existing) {
      subjects.set(input.subjectId, {
        ...input,
        tenantId: context.tenantId,
        status: "active",
        version: 1,
        archivedAt: null,
        processCount: 0,
        processSummary: [],
      });
    }
    this.subjects.set(context.tenantId, subjects);
    return Promise.resolve(toMonitoredSubject(subjects.get(input.subjectId)!));
  }

  createScheduledMonitoringProfile(
    context: RepositoryContext,
    input: ScheduledMonitoringProfileInput,
  ): Promise<MonitoredSubject> {
    this.assertMembership(context);
    if (input.sourceCode !== "djen" || Number.isNaN(input.scheduledAt.getTime())) {
      throw new RepositoryConflictError();
    }
    const scheduleKey = `${context.tenantId}:${input.subjectId}`;
    const existingSchedule = this.scheduledProfiles.get(scheduleKey);
    if (existingSchedule) {
      if (
        existingSchedule.targetId !== input.targetId ||
        existingSchedule.stateId !== input.stateId ||
        existingSchedule.sourceCode !== input.sourceCode ||
        existingSchedule.outboxEventId !== input.eventId
      ) {
        throw new RepositoryConflictError();
      }
      return this.createMonitoredSubject(context, input);
    }
    if (
      this.targets.get(context.tenantId)?.has(input.targetId) ||
      this.sourceStates.get(context.tenantId)?.has(input.stateId) ||
      this.outboxEvents.has(input.eventId)
    ) {
      throw new RepositoryConflictError();
    }

    const created = this.createMonitoredSubject(context, input);
    const targets =
      this.targets.get(context.tenantId) ??
      new Map<string, MonitoringTarget>();
    targets.set(input.targetId, {
      tenantId: context.tenantId,
      targetId: input.targetId,
      targetType: input.subjectType,
      displayLabel: input.displayLabel,
      protectedReference: input.protectedReference,
      jurisdiction: "BR",
      status: "active",
      nextCheckAt: null,
      version: 1,
      archivedAt: null,
    });
    this.targets.set(context.tenantId, targets);
    this.links.add(`${context.tenantId}:${input.subjectId}:${input.targetId}`);
    const states =
      this.sourceStates.get(context.tenantId) ??
      new Map<string, TargetSourceState>();
    states.set(input.stateId, {
      tenantId: context.tenantId,
      stateId: input.stateId,
      targetId: input.targetId,
      sourceId: "40000000-0000-7000-8000-000000000001",
      status: "disabled",
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextAttemptAt: null,
      consecutiveFailures: 0,
      version: 1,
    });
    this.sourceStates.set(context.tenantId, states);
    this.scheduledProfiles.set(scheduleKey, {
      targetId: input.targetId,
      stateId: input.stateId,
      sourceCode: input.sourceCode,
      outboxEventId: input.eventId,
    });
    this.outboxEvents.set(input.eventId, scheduleKey);
    return created;
  }

  updateMonitoredSubject(
    context: RepositoryContext,
    input: MonitoredSubjectUpdate,
  ): Promise<MonitoredSubject> {
    this.assertMembership(context);
    const subject = this.subjects.get(context.tenantId)?.get(input.subjectId);
    if (
      !subject ||
      subject.version !== input.expectedVersion ||
      subject.status !== "active"
    ) {
      throw new RepositoryConflictError();
    }
    const updated: StoredMonitoredSubject = {
      ...subject,
      displayLabel: input.displayLabel,
      version: subject.version + 1,
    };
    this.subjects.get(context.tenantId)?.set(input.subjectId, updated);
    return Promise.resolve(toMonitoredSubject(updated));
  }

  archiveMonitoredSubject(
    context: RepositoryContext,
    subjectId: string,
    expectedVersion: number,
  ): Promise<MonitoredSubject> {
    this.assertMembership(context);
    const subject = this.subjects.get(context.tenantId)?.get(subjectId);
    if (
      !subject ||
      subject.version !== expectedVersion ||
      subject.status !== "active"
    ) {
      throw new RepositoryConflictError();
    }
    const archived: StoredMonitoredSubject = {
      ...subject,
      status: "inactive",
      version: subject.version + 1,
      archivedAt: new Date(),
    };
    this.subjects.get(context.tenantId)?.set(subjectId, archived);
    const schedule = this.scheduledProfiles.get(
      `${context.tenantId}:${subjectId}`,
    );
    if (schedule) {
      const target = this.targets.get(context.tenantId)?.get(schedule.targetId);
      if (target?.status === "active") {
        this.targets.get(context.tenantId)?.set(schedule.targetId, {
          ...target,
          status: "inactive",
          nextCheckAt: null,
          version: target.version + 1,
          archivedAt: archived.archivedAt,
        });
      }
      const state = this.sourceStates
        .get(context.tenantId)
        ?.get(schedule.stateId);
      if (state) {
        this.sourceStates.get(context.tenantId)?.set(schedule.stateId, {
          ...state,
          status: "archived",
          nextAttemptAt: null,
          version: state.version + 1,
        });
      }
    }
    return Promise.resolve(toMonitoredSubject(archived));
  }

  listMonitoredSubjects(
    context: RepositoryContext,
    page: SubjectPageRequest,
  ): Promise<SubjectPage> {
    this.assertMembership(context);
    validatePageLimit(page.limit);
    const candidates = [...(this.subjects.get(context.tenantId)?.values() ?? [])]
      .filter(({ status }) => page.includeInactive === true || status === "active")
      .filter(
        ({ subjectId }) =>
          page.afterSubjectId === undefined ||
          subjectId > page.afterSubjectId,
      )
      .sort((left, right) => left.subjectId.localeCompare(right.subjectId));
    const storedItems = candidates.slice(0, page.limit);
    const items = storedItems.map(toMonitoredSubject);
    return Promise.resolve({
      items,
      nextCursor:
        candidates.length > items.length
          ? (items.at(-1)?.subjectId ?? null)
          : null,
    });
  }

  createMonitoringTarget(
    context: RepositoryContext,
    input: MonitoringTargetInput,
  ): Promise<void> {
    this.assertMembership(context);
    const targets =
      this.targets.get(context.tenantId) ??
      new Map<string, MonitoringTarget>();
    const existing = targets.get(input.targetId);
    if (
      existing &&
      (existing.targetType !== input.targetType ||
        existing.displayLabel !== input.displayLabel ||
        existing.protectedReference !== input.protectedReference ||
        existing.jurisdiction !== input.jurisdiction)
    ) {
      throw new RepositoryConflictError();
    }
    if (!existing) {
      targets.set(input.targetId, {
        ...input,
        tenantId: context.tenantId,
        status: "active",
        nextCheckAt: null,
        version: 1,
        archivedAt: null,
      });
    }
    this.targets.set(context.tenantId, targets);
    return Promise.resolve();
  }

  updateMonitoringTarget(
    context: RepositoryContext,
    input: MonitoringTargetUpdate,
  ): Promise<MonitoringTarget> {
    this.assertMembership(context);
    const target = this.targets.get(context.tenantId)?.get(input.targetId);
    if (
      !target ||
      target.version !== input.expectedVersion ||
      target.status !== "active"
    ) {
      throw new RepositoryConflictError();
    }
    const updated: MonitoringTarget = {
      ...target,
      displayLabel: input.displayLabel,
      version: target.version + 1,
    };
    this.targets.get(context.tenantId)?.set(input.targetId, updated);
    return Promise.resolve(updated);
  }

  archiveMonitoringTarget(
    context: RepositoryContext,
    targetId: string,
    expectedVersion: number,
  ): Promise<MonitoringTarget> {
    this.assertMembership(context);
    const target = this.targets.get(context.tenantId)?.get(targetId);
    if (
      !target ||
      target.version !== expectedVersion ||
      target.status !== "active"
    ) {
      throw new RepositoryConflictError();
    }
    const archived: MonitoringTarget = {
      ...target,
      status: "inactive",
      version: target.version + 1,
      archivedAt: new Date(),
    };
    this.targets.get(context.tenantId)?.set(targetId, archived);
    return Promise.resolve(archived);
  }

  listMonitoringTargets(
    context: RepositoryContext,
    page: TargetPageRequest,
  ): Promise<TargetPage> {
    this.assertMembership(context);
    validatePageLimit(page.limit);
    const candidates = [...(this.targets.get(context.tenantId)?.values() ?? [])]
      .filter(({ status }) => page.includeInactive === true || status === "active")
      .filter(
        ({ targetId }) =>
          page.afterTargetId === undefined || targetId > page.afterTargetId,
      )
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
    const items = candidates.slice(0, page.limit);
    return Promise.resolve({
      items,
      nextCursor:
        candidates.length > items.length
          ? (items.at(-1)?.targetId ?? null)
          : null,
    });
  }

  linkSubjectTarget(
    context: RepositoryContext,
    subjectId: string,
    targetId: string,
  ): Promise<void> {
    this.assertMembership(context);
    const subjectExists = this.subjects.get(context.tenantId)?.has(subjectId);
    const targetExists = this.targets.get(context.tenantId)?.has(targetId);
    if (!subjectExists || !targetExists) throw new RepositoryConflictError();
    this.links.add(`${context.tenantId}:${subjectId}:${targetId}`);
    return Promise.resolve();
  }

  createTargetSourceState(
    context: RepositoryContext,
    input: TargetSourceStateInput,
  ): Promise<TargetSourceState> {
    this.assertMembership(context);
    const target = this.targets.get(context.tenantId)?.get(input.targetId);
    if (!target || target.status !== "active") {
      throw new RepositoryConflictError();
    }
    const states =
      this.sourceStates.get(context.tenantId) ??
      new Map<string, TargetSourceState>();
    const existing = states.get(input.stateId);
    if (
      existing &&
      (existing.targetId !== input.targetId ||
        existing.sourceId !== input.sourceId)
    ) {
      throw new RepositoryConflictError();
    }
    if (existing) return Promise.resolve(existing);
    const created: TargetSourceState = {
      ...input,
      tenantId: context.tenantId,
      status: "pending",
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextAttemptAt: null,
      consecutiveFailures: 0,
      version: 1,
    };
    states.set(input.stateId, created);
    this.sourceStates.set(context.tenantId, states);
    return Promise.resolve(created);
  }

  updateTargetSourceState(
    context: RepositoryContext,
    input: TargetSourceStateUpdate,
  ): Promise<TargetSourceState> {
    this.assertMembership(context);
    const state = this.sourceStates.get(context.tenantId)?.get(input.stateId);
    if (!state || state.version !== input.expectedVersion) {
      throw new RepositoryConflictError();
    }
    if (
      (input.status === "ready" || input.status === "backoff") &&
      input.nextAttemptAt === null
    ) {
      throw new RepositoryConflictError();
    }
    const updated: TargetSourceState = {
      ...state,
      status: input.status,
      lastAttemptAt: input.attemptedAt,
      lastSuccessAt: input.succeededAt ?? state.lastSuccessAt,
      nextAttemptAt: input.nextAttemptAt,
      consecutiveFailures: input.consecutiveFailures,
      version: state.version + 1,
    };
    this.sourceStates.get(context.tenantId)?.set(input.stateId, updated);
    return Promise.resolve(updated);
  }

  inspectProfileSchedule(
    tenantId: string,
    subjectId: string,
  ): {
    readonly targetId: string;
    readonly stateId: string;
    readonly sourceCode: string;
    readonly status: TargetSourceState["status"];
    readonly nextAttemptAt: Date | null;
    readonly outboxEventId: string;
  } | null {
    const schedule = this.scheduledProfiles.get(`${tenantId}:${subjectId}`);
    if (!schedule) return null;
    const state = this.sourceStates.get(tenantId)?.get(schedule.stateId);
    if (!state) return null;
    return {
      ...schedule,
      status: state.status,
      nextAttemptAt: state.nextAttemptAt,
    };
  }

  private assertMembership(context: RepositoryContext): void {
    const tenant = this.tenants.get(context.tenantId);
    if (!tenant || tenant.ownerUserId !== context.userId) {
      throw new RepositoryAccessDeniedError();
    }
  }
}
