import { randomUUID } from "node:crypto";

import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export type DocumentMaterializationRequestState =
  | "queued"
  | "processing"
  | "available";

export interface DocumentMaterializationRequestResult {
  readonly materializationId: string;
  readonly documentId: string;
  readonly state: DocumentMaterializationRequestState;
}

export interface DocumentMaterializationRequestRepository {
  request(
    context: RepositoryContext,
    input: {
      readonly caseId: string;
      readonly documentId: string;
      readonly materializationId: string;
      readonly requestedAt: Date;
    },
  ): Promise<DocumentMaterializationRequestResult | null>;
}

export interface PersonalDocumentMaterializationRequestService {
  request(
    providerSubject: string,
    caseId: string,
    documentId: string,
  ): Promise<DocumentMaterializationRequestResult>;
}

export class DocumentMaterializationRequestValidationError extends Error {
  constructor() {
    super("Solicitação de documento inválida.");
    this.name = "DocumentMaterializationRequestValidationError";
  }
}

export class DocumentMaterializationNotFoundError extends Error {
  constructor() {
    super("Documento não encontrado.");
    this.name = "DocumentMaterializationNotFoundError";
  }
}

export class DocumentMaterializationProjectionError extends Error {
  constructor() {
    super("Document materialization projection is invalid.");
    this.name = "DocumentMaterializationProjectionError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set<DocumentMaterializationRequestState>([
  "queued", "processing", "available",
]);

const isProjectionValid = (
  value: DocumentMaterializationRequestResult,
  documentId: string,
): boolean =>
  UUID.test(value.materializationId) &&
  value.documentId === documentId &&
  STATES.has(value.state);

export class PersonalDocumentMaterializationRequests
  implements PersonalDocumentMaterializationRequestService
{
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: DocumentMaterializationRequestRepository,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(
    providerSubject: string,
    caseId: string,
    documentId: string,
  ): Promise<DocumentMaterializationRequestResult> {
    if (!UUID.test(caseId) || !UUID.test(documentId)) {
      throw new DocumentMaterializationRequestValidationError();
    }
    const context = await this.contextResolver.resolve(providerSubject);
    const materializationId = this.createId();
    const requestedAt = this.now();
    if (!UUID.test(materializationId) || Number.isNaN(requestedAt.getTime())) {
      throw new DocumentMaterializationProjectionError();
    }
    const result = await this.repository.request(context, {
      caseId, documentId, materializationId, requestedAt,
    });
    if (result === null) throw new DocumentMaterializationNotFoundError();
    if (!isProjectionValid(result, documentId)) {
      throw new DocumentMaterializationProjectionError();
    }
    return result;
  }
}
