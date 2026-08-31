import { describe, expect, it } from "vitest";

import {
  AesGcmIdentifierProtector,
  IdentifierProtectionError,
} from "./aes-gcm-identifier-protector.js";

const TENANT_ALPHA = "10000000-0000-8000-8000-000000000001";
const TENANT_BETA = "10000000-0000-8000-8000-000000000002";
const encryptionKeys = new Map([["v1", new Uint8Array(32).fill(17)]]);
const blindIndexKey = new Uint8Array(32).fill(29);

const createProtector = () =>
  new AesGcmIdentifierProtector({
    activeKeyVersion: "v1",
    blindIndexVersion: "v1",
    encryptionKeys,
    blindIndexKey,
  });

describe("AesGcmIdentifierProtector", () => {
  it("uses a stable tenant-bound blind index and randomized ciphertext", () => {
    const protector = createProtector();
    const input = {
      tenantId: TENANT_ALPHA,
      identifierType: "cpf" as const,
      plaintext: "12345678909",
      canonicalValue: "12345678909",
    };

    const first = protector.protect(input);
    const second = protector.protect(input);

    expect(second.protectedReference).toBe(first.protectedReference);
    expect(second.encryptedValue).not.toBe(first.encryptedValue);
    expect(first.protectedReference).toMatch(/^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/);
    expect(first.encryptedValue).toMatch(
      /^aes-256-gcm:v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/,
    );
    expect(
      protector.protect({ ...input, tenantId: TENANT_BETA }).protectedReference,
    ).not.toBe(first.protectedReference);
    expect(
      protector.protect({ ...input, identifierType: "cnpj" }).protectedReference,
    ).not.toBe(first.protectedReference);
    expect(
      protector.reveal({
        tenantId: TENANT_ALPHA,
        identifierType: "cpf",
        encryptedValue: first.encryptedValue,
        keyVersion: first.keyVersion,
      }),
    ).toBe("12345678909");
  });

  it("fails closed for tampering, wrong context or unknown versions", () => {
    const protector = createProtector();
    const protectedValue = protector.protect({
      tenantId: TENANT_ALPHA,
      identifierType: "name",
      plaintext: "Pessoa Sintética",
      canonicalValue: "PESSOA SINTETICA",
    });
    const replacement = protectedValue.encryptedValue.endsWith("A") ? "B" : "A";
    const tampered = `${protectedValue.encryptedValue.slice(0, -1)}${replacement}`;

    for (const request of [
      { tenantId: TENANT_ALPHA, identifierType: "name" as const, encryptedValue: tampered, keyVersion: "v1" },
      { tenantId: TENANT_BETA, identifierType: "name" as const, encryptedValue: protectedValue.encryptedValue, keyVersion: "v1" },
      { tenantId: TENANT_ALPHA, identifierType: "cpf" as const, encryptedValue: protectedValue.encryptedValue, keyVersion: "v1" },
      { tenantId: TENANT_ALPHA, identifierType: "name" as const, encryptedValue: protectedValue.encryptedValue, keyVersion: "v2" },
    ]) {
      expect(() => protector.reveal(request)).toThrow(IdentifierProtectionError);
    }
  });

  it("rejects invalid key configuration and malformed envelopes", () => {
    expect(
      () =>
        new AesGcmIdentifierProtector({
          activeKeyVersion: "v1",
          blindIndexVersion: "v1",
          encryptionKeys: new Map([["v1", new Uint8Array(31)]]),
          blindIndexKey,
        }),
    ).toThrow(IdentifierProtectionError);
    expect(
      () =>
        new AesGcmIdentifierProtector({
          activeKeyVersion: "missing",
          blindIndexVersion: "v1",
          encryptionKeys,
          blindIndexKey: new Uint8Array(31),
        }),
    ).toThrow(IdentifierProtectionError);
    expect(() =>
      createProtector().reveal({
        tenantId: TENANT_ALPHA,
        identifierType: "name",
        encryptedValue: "invalid-envelope",
        keyVersion: "v1",
      }),
    ).toThrow(IdentifierProtectionError);
  });
});
