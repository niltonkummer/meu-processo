import { createHash } from "node:crypto";

export type TargetType = "name" | "cpf" | "cnpj";
export type QueryField = "nomeParte" | "texto";

export interface TargetQuery {
  field: QueryField;
  value: string;
}

export interface NormalizedTarget {
  id: string;
  type: TargetType;
  normalizedValue: string;
  displayValue: string;
  strategy: QueryField;
  confidence: "medium" | "experimental";
  queries: TargetQuery[];
}

export class TargetValidationError extends Error {
  readonly code = "INVALID_TARGET";

  constructor(message: string) {
    super(message);
    this.name = "TargetValidationError";
  }
}

const onlyDigits = (value: string) => value.replace(/\D/g, "");

const hasRepeatedDigits = (value: string) => /^(\d)\1+$/.test(value);

const checksumDigit = (digits: string, weights: readonly number[]) => {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

const isValidCpf = (digits: string) => {
  if (digits.length !== 11 || hasRepeatedDigits(digits)) return false;

  const first = checksumDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checksumDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${first}${second}`);
};

const isValidCnpj = (digits: string) => {
  if (digits.length !== 14 || hasRepeatedDigits(digits)) return false;

  const first = checksumDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checksumDigit(
    digits,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return digits.endsWith(`${first}${second}`);
};

const formatCpf = (digits: string) =>
  `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;

const formatCnpj = (digits: string) =>
  `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;

const buildId = (type: TargetType, normalizedValue: string) => {
  const digest = createHash("sha256")
    .update(`${type}:${normalizedValue}`)
    .digest("hex")
    .slice(0, 20);
  return `${type}_${digest}`;
};

const assertInput = (
  input: unknown,
): { type: TargetType; value: string } => {
  if (typeof input !== "object" || input === null) {
    throw new TargetValidationError("Informe um alvo de busca válido.");
  }

  const record = input as Record<string, unknown>;
  if (
    !["name", "cpf", "cnpj"].includes(String(record.type)) ||
    typeof record.value !== "string"
  ) {
    throw new TargetValidationError("Tipo ou valor de busca inválido.");
  }

  return { type: record.type as TargetType, value: record.value };
};

export const normalizeTarget = (input: unknown): NormalizedTarget => {
  const { type, value } = assertInput(input);

  if (type === "name") {
    const normalizedValue = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (
      normalizedValue.length < 5 ||
      normalizedValue.length > 200 ||
      normalizedValue.split(" ").filter(Boolean).length < 2
    ) {
      throw new TargetValidationError(
        "Informe um nome completo entre 5 e 200 caracteres.",
      );
    }

    return {
      id: buildId(type, normalizedValue),
      type,
      normalizedValue,
      displayValue: normalizedValue,
      strategy: "nomeParte",
      confidence: "medium",
      queries: [{ field: "nomeParte", value: normalizedValue }],
    };
  }

  const normalizedValue = onlyDigits(value);
  if (type === "cpf") {
    if (!isValidCpf(normalizedValue)) {
      throw new TargetValidationError("Informe um CPF válido.");
    }

    return {
      id: buildId(type, normalizedValue),
      type,
      normalizedValue,
      displayValue: `***.***.***-${normalizedValue.slice(-2)}`,
      strategy: "texto",
      confidence: "experimental",
      queries: [
        { field: "texto", value: formatCpf(normalizedValue) },
        { field: "texto", value: normalizedValue },
      ],
    };
  }

  if (!isValidCnpj(normalizedValue)) {
    throw new TargetValidationError("Informe um CNPJ válido.");
  }

  return {
    id: buildId(type, normalizedValue),
    type,
    normalizedValue,
    displayValue: `**.***.***/****-${normalizedValue.slice(-2)}`,
    strategy: "texto",
    confidence: "experimental",
    queries: [
      { field: "texto", value: formatCnpj(normalizedValue) },
      { field: "texto", value: normalizedValue },
    ],
  };
};
