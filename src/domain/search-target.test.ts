import { describe, expect, it } from "vitest";

import { TargetValidationError, normalizeTarget } from "./search-target.js";

describe("normalizeTarget", () => {
  it("normalizes a full name and creates the official DJEN query", () => {
    const target = normalizeTarget({
      type: "name",
      value: "  Pessoa   Exemplo da Silva  ",
    });

    expect(target).toMatchObject({
      type: "name",
      normalizedValue: "Pessoa Exemplo da Silva",
      displayValue: "Pessoa Exemplo da Silva",
      strategy: "nomeParte",
      confidence: "medium",
      queries: [{ field: "nomeParte", value: "Pessoa Exemplo da Silva" }],
    });
    expect(target.id).toMatch(/^name_[a-f0-9]{20}$/);
  });

  it.each([
    ["short name", { type: "name", value: "Ana" }],
    ["single broad term", { type: "name", value: "Sociedade" }],
    ["unknown type", { type: "email", value: "pessoa@example.test" }],
    ["non object", null],
  ])("rejects %s", (_label, input) => {
    expect(() => normalizeTarget(input)).toThrow(TargetValidationError);
  });

  it("validates, normalizes and masks a CPF", () => {
    const target = normalizeTarget({ type: "cpf", value: "123.456.789-09" });

    expect(target).toMatchObject({
      type: "cpf",
      normalizedValue: "12345678909",
      displayValue: "***.***.***-09",
      strategy: "texto",
      confidence: "experimental",
      queries: [
        { field: "texto", value: "123.456.789-09" },
        { field: "texto", value: "12345678909" },
      ],
    });
  });

  it.each(["123", "111.111.111-11", "123.456.789-00"])(
    "rejects invalid CPF %s",
    (value) => {
      expect(() => normalizeTarget({ type: "cpf", value })).toThrow(
        TargetValidationError,
      );
    },
  );

  it("validates, normalizes and masks a CNPJ", () => {
    const target = normalizeTarget({ type: "cnpj", value: "11.222.333/0001-81" });

    expect(target).toMatchObject({
      type: "cnpj",
      normalizedValue: "11222333000181",
      displayValue: "**.***.***/****-81",
      strategy: "texto",
      confidence: "experimental",
      queries: [
        { field: "texto", value: "11.222.333/0001-81" },
        { field: "texto", value: "11222333000181" },
      ],
    });
  });

  it.each(["123", "11.111.111/1111-11", "11.222.333/0001-00"])(
    "rejects invalid CNPJ %s",
    (value) => {
      expect(() => normalizeTarget({ type: "cnpj", value })).toThrow(
        TargetValidationError,
      );
    },
  );
});
