import type {
  DocumentReference,
  DocumentRepository,
} from "../application/document-gateway.js";
import { scopesEqual, type TenantScope } from "../domain/access-control.js";

const matches = (
  reference: DocumentReference,
  scope: TenantScope,
  caseId: string,
): boolean =>
  reference.caseId === caseId && scopesEqual(reference.scope, scope);

export class MemoryDocumentRepository implements DocumentRepository {
  readonly #references: DocumentReference[];

  constructor(seed: readonly DocumentReference[] = []) {
    this.#references = [...seed];
  }

  list(
    scope: TenantScope,
    caseId: string,
  ): Promise<readonly DocumentReference[]> {
    return Promise.resolve(
      this.#references.filter((reference) => matches(reference, scope, caseId)),
    );
  }

  findById(
    scope: TenantScope,
    caseId: string,
    documentId: string,
  ): Promise<DocumentReference | undefined> {
    return Promise.resolve(
      this.#references.find(
        (reference) =>
          reference.documentId === documentId &&
          matches(reference, scope, caseId),
      ),
    );
  }

  upsert(candidate: DocumentReference): void {
    const existingIndex = this.#references.findIndex(
      (reference) =>
        reference.documentId === candidate.documentId &&
        matches(reference, candidate.scope, candidate.caseId),
    );
    if (existingIndex === -1) {
      this.#references.push(candidate);
      return;
    }
    this.#references[existingIndex] = candidate;
  }
}
