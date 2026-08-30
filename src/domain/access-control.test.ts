import { describe, expect, it } from "vitest";

import {
  canAccessScope,
  scopesEqual,
  type AuthenticatedPrincipal,
  type TenantScope,
} from "./access-control.js";

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [
    {
      organizationId: "org_alpha",
      role: "lawyer",
      active: true,
    },
    {
      organizationId: "org_inactive",
      role: "owner",
      active: false,
    },
  ],
};

describe("tenant access control", () => {
  it("allows only the owner of a personal scope", () => {
    expect(
      canAccessScope(principal, { kind: "personal", userId: "user_alpha" }),
    ).toBe(true);
    expect(
      canAccessScope(principal, { kind: "personal", userId: "user_beta" }),
    ).toBe(false);
  });

  it("allows only active organization memberships", () => {
    expect(
      canAccessScope(principal, {
        kind: "organization",
        organizationId: "org_alpha",
      }),
    ).toBe(true);
    expect(
      canAccessScope(principal, {
        kind: "organization",
        organizationId: "org_inactive",
      }),
    ).toBe(false);
    expect(
      canAccessScope(principal, {
        kind: "organization",
        organizationId: "org_unknown",
      }),
    ).toBe(false);
  });

  it("compares personal and organization scopes without coercion", () => {
    const personal: TenantScope = { kind: "personal", userId: "user_alpha" };
    const organization: TenantScope = {
      kind: "organization",
      organizationId: "user_alpha",
    };

    expect(canAccessScope(principal, personal)).toBe(true);
    expect(canAccessScope(principal, organization)).toBe(false);
    expect(scopesEqual(personal, organization)).toBe(false);
    expect(scopesEqual(personal, { kind: "personal", userId: "user_alpha" })).toBe(true);
    expect(scopesEqual(personal, { kind: "personal", userId: "user_beta" })).toBe(false);
    expect(
      scopesEqual(
        { kind: "organization", organizationId: "org_alpha" },
        { kind: "organization", organizationId: "org_alpha" },
      ),
    ).toBe(true);
    expect(
      scopesEqual(
        { kind: "organization", organizationId: "org_alpha" },
        { kind: "organization", organizationId: "org_beta" },
      ),
    ).toBe(false);
  });
});
