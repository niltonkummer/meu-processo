import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  TenantDataLifecycleService,
  type TenantDataLifecycleRequestDetails,
  type TenantDataLifecycleRequestResult,
} from "./tenant-data-lifecycle.js";

export interface TenantExportReader {
  readExport(input: {
    readonly storageObjectId: string;
    readonly expectedBytes: number;
    readonly expectedSha256: string;
  }): Promise<Uint8Array>;
}

export interface AccountDataExportDownload {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

export interface AccountDataControlsService {
  requestExport(providerSubject: string): Promise<TenantDataLifecycleRequestResult>;
  get(providerSubject: string, requestId: string): Promise<TenantDataLifecycleRequestDetails>;
  download(providerSubject: string, requestId: string): Promise<AccountDataExportDownload>;
  requestDeletion(input: {
    readonly providerSubject: string;
    readonly authenticatedAt: Date | undefined;
    readonly confirmation: string;
  }): Promise<TenantDataLifecycleRequestResult>;
}

export class AccountDataControlsValidationError extends Error {
  constructor() { super("Account data request is invalid."); this.name = "AccountDataControlsValidationError"; }
}
export class AccountDataRequestNotFoundError extends Error {
  constructor() { super("Account data request was not found."); this.name = "AccountDataRequestNotFoundError"; }
}
export class AccountDataExportUnavailableError extends Error {
  constructor() { super("Account data export is unavailable."); this.name = "AccountDataExportUnavailableError"; }
}
export class RecentAuthenticationRequiredError extends Error {
  constructor() { super("Recent authentication is required."); this.name = "RecentAuthenticationRequiredError"; }
}

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

export class PersonalAccountDataControls implements AccountDataControlsService {
  constructor(
    private readonly contexts: PersonalTenantContextResolver,
    private readonly lifecycle: TenantDataLifecycleService,
    private readonly reader: TenantExportReader,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestExport(providerSubject: string): Promise<TenantDataLifecycleRequestResult> {
    const requestedAt = this.now();
    const context = await this.contexts.resolve(providerSubject);
    return this.lifecycle.requestExport(context, {
      requestId: this.createId(), requestedAt,
    });
  }

  async get(providerSubject: string, requestId: string): Promise<TenantDataLifecycleRequestDetails> {
    const context = await this.contexts.resolve(providerSubject);
    const result = await this.lifecycle.get(context, requestId);
    if (!result) throw new AccountDataRequestNotFoundError();
    return result;
  }

  async download(providerSubject: string, requestId: string): Promise<AccountDataExportDownload> {
    const result = await this.get(providerSubject, requestId);
    const now = this.now();
    if (
      result.requestType !== "export" || result.state !== "completed" ||
      !result.artifactObjectId || !result.artifactSha256 ||
      result.artifactSizeBytes === null || !result.artifactExpiresAt ||
      result.artifactExpiresAt.getTime() <= now.getTime()
    ) throw new AccountDataExportUnavailableError();
    return {
      bytes: await this.reader.readExport({
        storageObjectId: result.artifactObjectId,
        expectedBytes: result.artifactSizeBytes,
        expectedSha256: result.artifactSha256,
      }),
      fileName: `meu-processo-exportacao-${requestId}.json`,
    };
  }

  async requestDeletion(input: {
    readonly providerSubject: string;
    readonly authenticatedAt: Date | undefined;
    readonly confirmation: string;
  }): Promise<TenantDataLifecycleRequestResult> {
    const requestedAt = this.now();
    if (input.confirmation !== "EXCLUIR MINHA CONTA") {
      throw new AccountDataControlsValidationError();
    }
    if (!input.authenticatedAt || Number.isNaN(input.authenticatedAt.getTime())) {
      throw new RecentAuthenticationRequiredError();
    }
    const age = requestedAt.getTime() - input.authenticatedAt.getTime();
    if (age < -ONE_MINUTE || age > FIVE_MINUTES) {
      throw new RecentAuthenticationRequiredError();
    }
    const context = await this.contexts.resolve(input.providerSubject);
    return this.lifecycle.requestDeletion(context, {
      requestId: this.createId(), requestedAt, confirmed: true,
    });
  }
}
