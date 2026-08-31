import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export type DocumentAccessClass = "public_official" | "restricted" | "unknown";
export type DocumentAvailabilityStatus =
  | "metadata_only"
  | "available"
  | "expired"
  | "unavailable";

export interface PersistedDocumentArtifact {
  readonly artifactId: string;
  readonly mediaType: "application/pdf";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly expiresAt: Date;
}

export interface PersistedCaseDocument {
  readonly tenantId: string;
  readonly documentId: string;
  readonly caseId: string;
  readonly caseEventId: string | null;
  readonly title: string;
  readonly documentType: string | null;
  readonly accessClass: DocumentAccessClass;
  readonly availabilityStatus: DocumentAvailabilityStatus;
  readonly expectedMediaType: "application/pdf";
  readonly sourceCreatedAt: Date;
  readonly lastVerifiedAt: Date;
  readonly source: {
    readonly sourceId: string;
    readonly official: boolean;
  };
  readonly artifact: PersistedDocumentArtifact | null;
}

export interface CaseDocumentCursor {
  readonly sourceCreatedAt: Date;
  readonly documentId: string;
}

export interface PersistedCaseDocumentRepository {
  list(
    context: RepositoryContext,
    caseId: string,
    page: { readonly limit: number; readonly after?: CaseDocumentCursor },
  ): Promise<{
    readonly caseFound: boolean;
    readonly items: readonly PersistedCaseDocument[];
    readonly next: CaseDocumentCursor | null;
  }>;
}

export interface PersonalCaseDocument {
  readonly documentId: string;
  readonly caseId: string;
  readonly caseEventId: string | null;
  readonly title: string;
  readonly documentType: string | null;
  readonly accessClass: DocumentAccessClass;
  readonly availabilityStatus: DocumentAvailabilityStatus;
  readonly expectedMediaType: "application/pdf";
  readonly sourceCreatedAt: string;
  readonly lastVerifiedAt: string;
  readonly source: { readonly sourceId: string; readonly official: boolean };
  readonly artifact: null | {
    readonly artifactId: string;
    readonly mediaType: "application/pdf";
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly expiresAt: string;
  };
}

export interface PersonalCaseDocumentsService {
  list(
    providerSubject: string,
    caseId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly PersonalCaseDocument[];
    readonly nextCursor: string | null;
  }>;
}

export class CaseDocumentPageValidationError extends Error {
  constructor() {
    super("Paginação de documentos inválida.");
    this.name = "CaseDocumentPageValidationError";
  }
}

export class CaseDocumentsNotFoundError extends Error {
  constructor() {
    super("Processo não encontrado.");
    this.name = "CaseDocumentsNotFoundError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{8,512}$/;

const decodeCursor = (cursor: string): CaseDocumentCursor => {
  try {
    if (!CURSOR.test(cursor)) throw new CaseDocumentPageValidationError();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CaseDocumentPageValidationError();
    }
    const record = value as Record<string, unknown>;
    const sourceCreatedAt = new Date(String(record.at));
    if (
      Object.keys(record).length !== 3 ||
      record.v !== 1 ||
      typeof record.at !== "string" ||
      Number.isNaN(sourceCreatedAt.getTime()) ||
      typeof record.id !== "string" ||
      !UUID.test(record.id)
    ) throw new CaseDocumentPageValidationError();
    return { sourceCreatedAt, documentId: record.id };
  } catch (error) {
    if (error instanceof CaseDocumentPageValidationError) throw error;
    throw new CaseDocumentPageValidationError();
  }
};

const encodeCursor = (cursor: CaseDocumentCursor): string =>
  Buffer.from(JSON.stringify({
    v: 1,
    at: cursor.sourceCreatedAt.toISOString(),
    id: cursor.documentId,
  }), "utf8").toString("base64url");

const toPublicDocument = (item: PersistedCaseDocument): PersonalCaseDocument => ({
  documentId: item.documentId,
  caseId: item.caseId,
  caseEventId: item.caseEventId,
  title: item.title,
  documentType: item.documentType,
  accessClass: item.accessClass,
  availabilityStatus: item.availabilityStatus,
  expectedMediaType: item.expectedMediaType,
  sourceCreatedAt: item.sourceCreatedAt.toISOString(),
  lastVerifiedAt: item.lastVerifiedAt.toISOString(),
  source: item.source,
  artifact: item.artifact ? {
    artifactId: item.artifact.artifactId,
    mediaType: item.artifact.mediaType,
    sizeBytes: item.artifact.sizeBytes,
    sha256: item.artifact.sha256,
    expiresAt: item.artifact.expiresAt.toISOString(),
  } : null,
});

export class PersonalCaseDocuments implements PersonalCaseDocumentsService {
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: PersistedCaseDocumentRepository,
  ) {}

  async list(
    providerSubject: string,
    caseId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ) {
    if (!UUID.test(caseId) || !Number.isInteger(page.limit) ||
        page.limit < 1 || page.limit > 100) {
      throw new CaseDocumentPageValidationError();
    }
    const context = await this.contextResolver.resolve(providerSubject);
    const result = await this.repository.list(context, caseId, {
      limit: page.limit,
      ...(page.cursor ? { after: decodeCursor(page.cursor) } : {}),
    });
    if (!result.caseFound || result.items.some((item) =>
      item.tenantId !== context.tenantId || item.caseId !== caseId)) {
      throw new CaseDocumentsNotFoundError();
    }
    return {
      items: result.items.map(toPublicDocument),
      nextCursor: result.next ? encodeCursor(result.next) : null,
    };
  }
}
