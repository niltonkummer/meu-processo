import type {
  AuthenticatedPrincipal,
  OrganizationMembership,
} from "../domain/access-control.js";

export interface VerifiedIdentity {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export interface IdentityTokenDecoder {
  decode(token: string): Promise<VerifiedIdentity>;
}

export interface MembershipDirectory {
  listActiveForUser(
    userId: string,
  ): Promise<readonly OrganizationMembership[]>;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedPrincipal>;
}

export class AuthenticationRejectedError extends Error {
  constructor() {
    super("Identity is not eligible for private access.");
    this.name = "AuthenticationRejectedError";
  }
}

export class VerifiedTokenAuthenticator implements TokenVerifier {
  constructor(
    private readonly decoder: IdentityTokenDecoder,
    private readonly memberships: MembershipDirectory,
  ) {}

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    const identity = await this.decoder.decode(token);
    if (
      identity.userId.trim().length === 0 ||
      identity.email.trim().length === 0 ||
      !identity.emailVerified
    ) {
      throw new AuthenticationRejectedError();
    }

    const memberships = await this.memberships.listActiveForUser(identity.userId);
    return {
      userId: identity.userId,
      memberships: memberships.filter((membership) => membership.active),
    };
  }
}
