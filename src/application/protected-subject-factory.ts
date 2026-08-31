import type {
  MonitoredSubjectInput,
  RepositoryContext,
  SubjectType,
} from "./foundation-repository.js";
import { normalizeTarget } from "../domain/search-target.js";

export interface IdentifierProtectionRequest {
  readonly tenantId: string;
  readonly identifierType: SubjectType;
  readonly plaintext: string;
  readonly canonicalValue: string;
}

export interface IdentifierProtectionEnvelope {
  readonly protectedReference: string;
  readonly encryptedValue: string;
  readonly keyVersion: string;
}

export interface IdentifierRevealRequest {
  readonly tenantId: string;
  readonly identifierType: SubjectType;
  readonly encryptedValue: string;
  readonly keyVersion: string;
}

export interface IdentifierProtector {
  protect(request: IdentifierProtectionRequest): IdentifierProtectionEnvelope;
  reveal?(request: IdentifierRevealRequest): string;
}

export interface ProtectedSubjectCommand {
  readonly subjectId: string;
  readonly subjectType: SubjectType;
  readonly value: string;
}

const canonicalizeName = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleUpperCase("pt-BR");

const minimizeName = (value: string): string => {
  const words = value.split(" ");
  const first = Array.from(words[0]!)[0]!;
  const last = Array.from(words.at(-1)!)[0]!;
  return `${first}. ${last}.`;
};

export class ProtectedSubjectFactory {
  constructor(private readonly protector: IdentifierProtector) {}

  create(
    context: RepositoryContext,
    command: ProtectedSubjectCommand,
  ): MonitoredSubjectInput {
    const normalized = normalizeTarget({
      type: command.subjectType,
      value: command.value,
    });
    const isName = normalized.type === "name";
    const protection = this.protector.protect({
      tenantId: context.tenantId,
      identifierType: command.subjectType,
      plaintext: normalized.normalizedValue,
      canonicalValue: isName
        ? canonicalizeName(normalized.normalizedValue)
        : normalized.normalizedValue,
    });

    return {
      subjectId: command.subjectId,
      subjectType: command.subjectType,
      displayLabel: isName
        ? minimizeName(normalized.normalizedValue)
        : normalized.displayValue,
      ...protection,
    };
  }
}
