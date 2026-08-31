import { describe, expect, it, vi } from "vitest";

import type { IdentifierProtector } from "./protected-subject-factory.js";
import { ProtectedSubjectFactory } from "./protected-subject-factory.js";

const TENANT_ID = "10000000-0000-8000-8000-000000000001";
const SUBJECT_ID = "20000000-0000-8000-8000-000000000001";

const protector = (): IdentifierProtector => ({
  protect: vi.fn().mockReturnValue({
    protectedReference: "hmac-sha256:v1:synthetic-fingerprint",
    encryptedValue: "aes-256-gcm:v1:synthetic-envelope",
    keyVersion: "v1",
  }),
});

describe("ProtectedSubjectFactory", () => {
  it("canonicalizes and minimizes a name before protection", () => {
    const identifierProtector = protector();
    const factory = new ProtectedSubjectFactory(identifierProtector);

    expect(
      factory.create(
        { userId: "user-synthetic", tenantId: TENANT_ID },
        {
          subjectId: SUBJECT_ID,
          subjectType: "name",
          value: "  Álvaro   de Souza  ",
        },
      ),
    ).toEqual({
      subjectId: SUBJECT_ID,
      subjectType: "name",
      displayLabel: "Á. S.",
      protectedReference: "hmac-sha256:v1:synthetic-fingerprint",
      encryptedValue: "aes-256-gcm:v1:synthetic-envelope",
      keyVersion: "v1",
    });
    expect(identifierProtector.protect).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      identifierType: "name",
      plaintext: "Álvaro de Souza",
      canonicalValue: "ALVARO DE SOUZA",
    });
  });

  it.each([
    ["cpf", "123.456.789-09", "***.***.***-09", "12345678909"],
    ["cnpj", "11.222.333/0001-81", "**.***.***/****-81", "11222333000181"],
  ] as const)(
    "validates and minimizes a %s",
    (subjectType, value, displayLabel, canonicalValue) => {
      const identifierProtector = protector();
      const factory = new ProtectedSubjectFactory(identifierProtector);

      expect(
        factory.create(
          { userId: "user-synthetic", tenantId: TENANT_ID },
          { subjectId: SUBJECT_ID, subjectType, value },
        ),
      ).toMatchObject({ subjectType, displayLabel });
      expect(identifierProtector.protect).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        identifierType: subjectType,
        plaintext: canonicalValue,
        canonicalValue,
      });
    },
  );

  it("rejects invalid input before invoking protection", () => {
    const identifierProtector = protector();
    const factory = new ProtectedSubjectFactory(identifierProtector);

    expect(() =>
      factory.create(
        { userId: "user-synthetic", tenantId: TENANT_ID },
        { subjectId: SUBJECT_ID, subjectType: "cpf", value: "111.111.111-11" },
      ),
    ).toThrow("Informe um CPF válido.");
    expect(identifierProtector.protect).not.toHaveBeenCalled();
  });
});
