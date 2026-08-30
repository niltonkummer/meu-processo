import { describe, expect, it, vi } from "vitest";

import type { OrganizationMembership } from "../domain/access-control.js";
import {
  AuthenticationRejectedError,
  VerifiedTokenAuthenticator,
  type IdentityTokenDecoder,
  type MembershipDirectory,
} from "./authentication.js";

const activeMembership: OrganizationMembership = {
  organizationId: "org_alpha",
  role: "lawyer",
  active: true,
};

const inactiveMembership: OrganizationMembership = {
  organizationId: "org_inactive",
  role: "viewer",
  active: false,
};

const directory = (
  memberships: readonly OrganizationMembership[] = [],
): MembershipDirectory => ({
  listActiveForUser: vi.fn().mockResolvedValue(memberships),
});

describe("VerifiedTokenAuthenticator", () => {
  it("builds a principal from verified identity and active server memberships", async () => {
    const decoder: IdentityTokenDecoder = {
      decode: vi.fn().mockResolvedValue({
        userId: "firebase_user",
        email: "pessoa@example.test",
        emailVerified: true,
      }),
    };
    const memberships = directory([activeMembership, inactiveMembership]);
    const authenticator = new VerifiedTokenAuthenticator(decoder, memberships);

    await expect(authenticator.verify("signed-token")).resolves.toEqual({
      userId: "firebase_user",
      memberships: [activeMembership],
    });
    expect(decoder.decode).toHaveBeenCalledWith("signed-token");
    expect(memberships.listActiveForUser).toHaveBeenCalledWith("firebase_user");
  });

  it.each([
    { userId: "", email: "pessoa@example.test", emailVerified: true },
    { userId: "firebase_user", email: "", emailVerified: true },
    { userId: "firebase_user", email: "pessoa@example.test", emailVerified: false },
  ])("rejects an identity that is not eligible for private access", async (identity) => {
    const memberships = directory();
    const authenticator = new VerifiedTokenAuthenticator(
      { decode: vi.fn().mockResolvedValue(identity) },
      memberships,
    );

    await expect(authenticator.verify("signed-token")).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    expect(memberships.listActiveForUser).not.toHaveBeenCalled();
  });
});
