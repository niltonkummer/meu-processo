import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import type { RepositoryContext } from "./foundation-repository.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";

export type DocumentDownloadOutcome =
  | "delivered"
  | "object_missing"
  | "integrity_failed"
  | "storage_failed";

export interface DocumentDeliveryAuthorization {
  readonly authorizationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly caseId: string;
  readonly documentId: string;
  readonly artifactId: string;
  readonly storageObjectId: string;
  readonly title: string;
  readonly mediaType: "application/pdf";
  readonly sizeBytes: number;
  readonly sha256: string;
}

export type DocumentAuthorizationResult =
  | { readonly kind: "authorized"; readonly authorization: DocumentDeliveryAuthorization }
  | { readonly kind: "not_found" }
  | { readonly kind: "quota_exceeded" };

export interface DocumentDeliveryRepository {
  authorize(
    context: RepositoryContext,
    input: {
      readonly caseId: string;
      readonly documentId: string;
      readonly authorizationId: string;
      readonly requestId: string;
      readonly quotaPerMinute: number;
    },
  ): Promise<DocumentAuthorizationResult>;
  recordOutcome(
    context: RepositoryContext,
    authorizationId: string,
    outcome: DocumentDownloadOutcome,
  ): Promise<boolean>;
}

export interface PrivateObjectStore {
  read(storageObjectId: string, maximumBytes: number): Promise<Uint8Array>;
}

export interface PersonalDocumentDeliveryService {
  download(
    providerSubject: string,
    caseId: string,
    documentId: string,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: "application/pdf";
    readonly sha256: string;
    readonly fileName: string;
  }>;
}

export class DocumentDeliveryValidationError extends Error {
  constructor() {
    super("Documento inválido.");
    this.name = "DocumentDeliveryValidationError";
  }
}

export class PersistedDocumentNotFoundError extends Error {
  constructor() {
    super("Documento não encontrado.");
    this.name = "PersistedDocumentNotFoundError";
  }
}

export class DocumentDownloadQuotaExceededError extends Error {
  readonly retryAfterSeconds = 60;

  constructor() {
    super("Limite temporário de downloads atingido.");
    this.name = "DocumentDownloadQuotaExceededError";
  }
}

export class DocumentContentUnavailableError extends Error {
  constructor() {
    super("O documento não pôde ser entregue.");
    this.name = "DocumentContentUnavailableError";
  }
}

export class PrivateObjectNotFoundError extends Error {
  constructor() {
    super("Private object not found.");
    this.name = "PrivateObjectNotFoundError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const isAuthorizationValid = (
  value: DocumentDeliveryAuthorization,
  context: RepositoryContext,
  input: { readonly caseId: string; readonly documentId: string; readonly authorizationId: string },
  maximumBytes: number,
): boolean =>
  value.authorizationId === input.authorizationId &&
  value.tenantId === context.tenantId &&
  value.userId === context.userId &&
  value.caseId === input.caseId &&
  value.documentId === input.documentId &&
  UUID.test(value.artifactId) &&
  value.storageObjectId ===
    `documents/tenant/${context.tenantId}/${input.documentId}/${value.artifactId}.pdf` &&
  typeof value.title === "string" && value.title.length >= 1 &&
  value.title.length <= 200 && !hasControlCharacter(value.title) &&
  value.mediaType === "application/pdf" &&
  Number.isInteger(value.sizeBytes) && value.sizeBytes >= 9 &&
  value.sizeBytes <= maximumBytes && SHA256.test(value.sha256);

const hasPdfSignature = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 9 &&
  bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
  bytes[3] === 0x46 && bytes[4] === 0x2d;

const hashMatches = (bytes: Uint8Array, expected: string): boolean => {
  const actual = createHash("sha256").update(bytes).digest();
  const expectedBytes = Buffer.from(expected.slice("sha256:".length), "hex");
  return expectedBytes.byteLength === actual.byteLength &&
    timingSafeEqual(actual, expectedBytes);
};

export class PersonalDocumentDelivery implements PersonalDocumentDeliveryService {
  constructor(
    private readonly contextResolver: PersonalTenantContextResolver,
    private readonly repository: DocumentDeliveryRepository,
    private readonly objectStore: PrivateObjectStore,
    private readonly limits: {
      readonly quotaPerMinute: number;
      readonly maximumBytes: number;
    },
    private readonly createId: () => string = randomUUID,
  ) {}

  async download(providerSubject: string, caseId: string, documentId: string) {
    if (!UUID.test(caseId) || !UUID.test(documentId)) {
      throw new DocumentDeliveryValidationError();
    }
    const context = await this.contextResolver.resolve(providerSubject);
    const authorizationId = this.createId();
    const requestId = this.createId();
    if (!UUID.test(authorizationId) || !UUID.test(requestId)) {
      throw new DocumentContentUnavailableError();
    }
    const result = await this.repository.authorize(context, {
      caseId,
      documentId,
      authorizationId,
      requestId,
      quotaPerMinute: this.limits.quotaPerMinute,
    });
    if (result.kind === "not_found") throw new PersistedDocumentNotFoundError();
    if (result.kind === "quota_exceeded") {
      throw new DocumentDownloadQuotaExceededError();
    }
    const authorization = result.authorization;
    if (!isAuthorizationValid(
      authorization,
      context,
      { caseId, documentId, authorizationId },
      this.limits.maximumBytes,
    )) throw new DocumentContentUnavailableError();

    let bytes: Uint8Array;
    try {
      bytes = await this.objectStore.read(
        authorization.storageObjectId,
        authorization.sizeBytes,
      );
    } catch (error) {
      const outcome = error instanceof PrivateObjectNotFoundError
        ? "object_missing" : "storage_failed";
      await this.repository.recordOutcome(context, authorizationId, outcome);
      throw new DocumentContentUnavailableError();
    }

    if (
      bytes.byteLength !== authorization.sizeBytes ||
      !hasPdfSignature(bytes) ||
      !hashMatches(bytes, authorization.sha256)
    ) {
      await this.repository.recordOutcome(
        context, authorizationId, "integrity_failed",
      );
      throw new DocumentContentUnavailableError();
    }
    const recorded = await this.repository.recordOutcome(
      context, authorizationId, "delivered",
    );
    if (!recorded) throw new DocumentContentUnavailableError();
    return {
      bytes,
      mediaType: "application/pdf" as const,
      sha256: authorization.sha256,
      fileName: `${authorization.title}.pdf`,
    };
  }
}
