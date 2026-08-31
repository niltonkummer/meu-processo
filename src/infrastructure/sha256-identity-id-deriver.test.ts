import { describe, expect, it } from "vitest";

import { Sha256IdentityIdDeriver } from "./sha256-identity-id-deriver.js";

describe("Sha256IdentityIdDeriver", () => {
  it("creates stable RFC UUID v8 ids separated by purpose and subject", () => {
    const first = new Sha256IdentityIdDeriver();
    const second = new Sha256IdentityIdDeriver();

    const userId = first.derive("user", "firebase-synthetic-subject");
    expect(second.derive("user", "firebase-synthetic-subject")).toBe(userId);
    expect(userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.derive("personal-tenant", "firebase-synthetic-subject")).not.toBe(
      userId,
    );
    expect(first.derive("user", "another-synthetic-subject")).not.toBe(userId);
  });
});
