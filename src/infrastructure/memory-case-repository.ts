import type {
  CanonicalCase,
  CaseRepository,
} from "../application/case-portfolio.js";
import { scopesEqual, type TenantScope } from "../domain/access-control.js";

export class MemoryCaseRepository implements CaseRepository {
  readonly #cases: CanonicalCase[];

  constructor(seed: readonly CanonicalCase[] = []) {
    this.#cases = [...seed];
  }

  list(scope: TenantScope): Promise<readonly CanonicalCase[]> {
    return Promise.resolve(
      this.#cases.filter((candidate) => scopesEqual(candidate.scope, scope)),
    );
  }

  findById(
    scope: TenantScope,
    caseId: string,
  ): Promise<CanonicalCase | undefined> {
    return Promise.resolve(
      this.#cases.find(
        (candidate) =>
          candidate.caseId === caseId && scopesEqual(candidate.scope, scope),
      ),
    );
  }

  upsert(candidate: CanonicalCase): void {
    const existingIndex = this.#cases.findIndex(
      (stored) =>
        stored.caseId === candidate.caseId &&
        scopesEqual(stored.scope, candidate.scope),
    );

    if (existingIndex === -1) {
      this.#cases.push(candidate);
      return;
    }

    this.#cases[existingIndex] = candidate;
  }
}
