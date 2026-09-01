import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import type {
  IdentifierProtectionEnvelope,
  IdentifierProtectionRequest,
  IdentifierProtector,
  IdentifierRevealRequest,
} from "../application/protected-subject-factory.js";

interface IdentifierProtectorConfig {
  readonly activeKeyVersion: string;
  readonly blindIndexVersion: string;
  readonly encryptionKeys: ReadonlyMap<string, Uint8Array>;
  readonly blindIndexKey: Uint8Array;
}

const VERSION_PATTERN = /^v[1-9]\d*$/;
const encode = (value: Uint8Array): string =>
  Buffer.from(value).toString("base64url");
const decode = (value: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new IdentifierProtectionError();
  const decoded = Buffer.from(value, "base64url");
  if (encode(decoded) !== value) throw new IdentifierProtectionError();
  return decoded;
};

export class IdentifierProtectionError extends Error {
  constructor() {
    super("Identifier protection operation failed.");
    this.name = "IdentifierProtectionError";
  }
}

const aad = (
  tenantId: string,
  identifierType: string,
  keyVersion: string,
): Buffer =>
  Buffer.from(
    `meu-processo:identifier:${tenantId}:${identifierType}:${keyVersion}`,
    "utf8",
  );

export class AesGcmIdentifierProtector implements IdentifierProtector {
  private readonly activeKey: Buffer;
  private readonly blindIndexKey: Buffer;

  constructor(private readonly config: IdentifierProtectorConfig) {
    const activeKey = config.encryptionKeys.get(config.activeKeyVersion);
    if (
      !VERSION_PATTERN.test(config.activeKeyVersion) ||
      !VERSION_PATTERN.test(config.blindIndexVersion) ||
      !activeKey ||
      activeKey.byteLength !== 32 ||
      config.blindIndexKey.byteLength !== 32 ||
      [...config.encryptionKeys.values()].some((key) => key.byteLength !== 32)
    ) {
      throw new IdentifierProtectionError();
    }
    this.activeKey = Buffer.from(activeKey);
    this.blindIndexKey = Buffer.from(config.blindIndexKey);
  }

  protect(request: IdentifierProtectionRequest): IdentifierProtectionEnvelope {
    const reference = createHmac("sha256", this.blindIndexKey)
      .update(request.tenantId)
      .update("\0")
      .update(request.identifierType)
      .update("\0")
      .update(request.canonicalValue)
      .digest();
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.activeKey, initializationVector);
    cipher.setAAD(
      aad(
        request.tenantId,
        request.identifierType,
        this.config.activeKeyVersion,
      ),
    );
    const encrypted = Buffer.concat([
      cipher.update(request.plaintext, "utf8"),
      cipher.final(),
    ]);

    return {
      protectedReference: `hmac-sha256:${this.config.blindIndexVersion}:${encode(reference)}`,
      encryptedValue: [
        "aes-256-gcm",
        this.config.activeKeyVersion,
        encode(initializationVector),
        encode(encrypted),
        encode(cipher.getAuthTag()),
      ].join(":"),
      keyVersion: this.config.activeKeyVersion,
    };
  }

  reveal(request: IdentifierRevealRequest): string {
    try {
      const parts = request.encryptedValue.split(":");
      if (
        parts.length !== 5 ||
        parts[0] !== "aes-256-gcm" ||
        parts[1] !== request.keyVersion ||
        !VERSION_PATTERN.test(request.keyVersion)
      ) {
        throw new IdentifierProtectionError();
      }
      const key = this.config.encryptionKeys.get(request.keyVersion);
      if (!key || key.byteLength !== 32) throw new IdentifierProtectionError();
      const initializationVector = decode(parts[2] ?? "");
      const encrypted = decode(parts[3] ?? "");
      const authenticationTag = decode(parts[4] ?? "");
      if (initializationVector.byteLength !== 12 || authenticationTag.byteLength !== 16) {
        throw new IdentifierProtectionError();
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(key),
        initializationVector,
      );
      decipher.setAAD(
        aad(request.tenantId, request.identifierType, request.keyVersion),
      );
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new IdentifierProtectionError();
    }
  }
}
