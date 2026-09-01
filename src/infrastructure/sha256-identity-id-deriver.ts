import { createHash } from "node:crypto";

import type {
  IdentityIdDeriver,
  IdentityIdPurpose,
} from "../application/personal-tenant-resolver.js";

const formatUuid = (bytes: Uint8Array): string => {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

export class Sha256IdentityIdDeriver implements IdentityIdDeriver {
  derive(purpose: IdentityIdPurpose, providerSubject: string): string {
    const bytes = new Uint8Array(
      createHash("sha256")
        .update("meu-processo:identity:")
        .update(purpose)
        .update("\0")
        .update(providerSubject)
        .digest()
        .subarray(0, 16),
    );
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    return formatUuid(bytes);
  }
}
