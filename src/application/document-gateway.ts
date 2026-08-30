import {
  getAuthorizedCase,
  type CaseRepository,
} from "./case-portfolio.js";
import {
  scopesEqual,
  type AuthenticatedPrincipal,
  type TenantScope,
} from "../domain/access-control.js";

export interface DocumentReference {
  documentId: string;
  caseId: string;
  scope: TenantScope;
  sourceId: string;
  title: string;
  fileName: string;
  mediaType: "application/pdf";
  sourceUrl: string;
  collectedAt: string;
  expectedSha256?: string;
}

export interface DocumentMetadata {
  documentId: string;
  caseId: string;
  sourceId: string;
  title: string;
  fileName: string;
  mediaType: "application/pdf";
  collectedAt: string;
}

export interface DownloadedDocument {
  bytes: Uint8Array;
  mediaType: "application/pdf";
  sha256: string;
}

export interface DocumentChallengeAnswer {
  challengeId: string;
  answer: string;
}

export interface AuthorizedDocument extends DownloadedDocument {
  fileName: string;
}

export interface DocumentRepository {
  list(
    scope: TenantScope,
    caseId: string,
  ): Promise<readonly DocumentReference[]>;
  findById(
    scope: TenantScope,
    caseId: string,
    documentId: string,
  ): Promise<DocumentReference | undefined>;
}

export interface DocumentClient {
  download(reference: DocumentReference): Promise<DownloadedDocument>;
  completeChallenge?(
    reference: DocumentReference,
    challenge: DocumentChallengeAnswer,
  ): Promise<DownloadedDocument>;
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Documento não encontrado.");
    this.name = "DocumentNotFoundError";
  }
}

const belongsToCase = (
  reference: DocumentReference,
  scope: TenantScope,
  caseId: string,
): boolean =>
  reference.caseId === caseId && scopesEqual(reference.scope, scope);

const toMetadata = (reference: DocumentReference): DocumentMetadata => ({
  documentId: reference.documentId,
  caseId: reference.caseId,
  sourceId: reference.sourceId,
  title: reference.title,
  fileName: reference.fileName,
  mediaType: reference.mediaType,
  collectedAt: reference.collectedAt,
});

export const listAuthorizedDocuments = async (
  principal: AuthenticatedPrincipal,
  scope: TenantScope,
  caseId: string,
  caseRepository: CaseRepository,
  documentRepository: DocumentRepository,
): Promise<readonly DocumentMetadata[]> => {
  await getAuthorizedCase(principal, scope, caseId, caseRepository);
  const references = await documentRepository.list(scope, caseId);
  return references
    .filter((reference) => belongsToCase(reference, scope, caseId))
    .map(toMetadata);
};

export const downloadAuthorizedDocument = async (
  principal: AuthenticatedPrincipal,
  scope: TenantScope,
  caseId: string,
  documentId: string,
  caseRepository: CaseRepository,
  documentRepository: DocumentRepository,
  client: DocumentClient,
): Promise<AuthorizedDocument> => {
  await getAuthorizedCase(principal, scope, caseId, caseRepository);
  const reference = await documentRepository.findById(
    scope,
    caseId,
    documentId,
  );
  if (!reference || !belongsToCase(reference, scope, caseId)) {
    throw new DocumentNotFoundError();
  }

  const downloaded = await client.download(reference);
  return { ...downloaded, fileName: reference.fileName };
};
