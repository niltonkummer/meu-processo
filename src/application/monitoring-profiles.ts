import type {
  FoundationRepository,
  MonitoredSubject,
  RepositoryContext,
  SubjectPage,
  SubjectPageRequest,
  SubjectType,
} from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import { ProtectedSubjectFactory } from "./protected-subject-factory.js";

export interface CreateMonitoringProfileCommand {
  readonly subjectType: SubjectType;
  readonly value: string;
}

export interface MonitoringProfilesService {
  create(
    providerSubject: string,
    command: CreateMonitoringProfileCommand,
  ): Promise<MonitoredSubject>;
  list(
    providerSubject: string,
    page: SubjectPageRequest,
  ): Promise<SubjectPage>;
  archive(
    providerSubject: string,
    subjectId: string,
    expectedVersion: number,
  ): Promise<MonitoredSubject>;
}

export class MonitoringProfiles implements MonitoringProfilesService {
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: FoundationRepository,
    private readonly subjectFactory: ProtectedSubjectFactory,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    providerSubject: string,
    command: CreateMonitoringProfileCommand,
  ): Promise<MonitoredSubject> {
    const context = await this.resolveContext(providerSubject);
    const input = this.subjectFactory.create(context, {
      subjectId: this.createId(),
      ...command,
    });
    return this.repository.createScheduledMonitoringProfile(context, {
      ...input,
      targetId: this.createId(),
      stateId: this.createId(),
      eventId: this.createId(),
      sourceCode: "djen",
      scheduledAt: this.now(),
    });
  }

  async list(
    providerSubject: string,
    page: SubjectPageRequest,
  ): Promise<SubjectPage> {
    const context = await this.resolveContext(providerSubject);
    return this.repository.listMonitoredSubjects(context, page);
  }

  async archive(
    providerSubject: string,
    subjectId: string,
    expectedVersion: number,
  ): Promise<MonitoredSubject> {
    const context = await this.resolveContext(providerSubject);
    return this.repository.archiveMonitoredSubject(
      context,
      subjectId,
      expectedVersion,
    );
  }

  private resolveContext(providerSubject: string): Promise<RepositoryContext> {
    return this.contextResolver.resolve(providerSubject);
  }
}
