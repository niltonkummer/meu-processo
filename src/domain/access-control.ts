export type MembershipRole = "owner" | "admin" | "lawyer" | "viewer";

export interface OrganizationMembership {
  organizationId: string;
  role: MembershipRole;
  active: boolean;
}

export interface AuthenticatedPrincipal {
  userId: string;
  memberships: readonly OrganizationMembership[];
  authenticatedAt?: Date;
}

export type TenantScope =
  | { kind: "personal"; userId: string }
  | { kind: "organization"; organizationId: string };

export const scopesEqual = (left: TenantScope, right: TenantScope): boolean => {
  if (left.kind !== right.kind) return false;

  return left.kind === "personal"
    ? left.userId === (right as Extract<TenantScope, { kind: "personal" }>).userId
    : left.organizationId ===
        (right as Extract<TenantScope, { kind: "organization" }>).organizationId;
};

export const canAccessScope = (
  principal: AuthenticatedPrincipal,
  scope: TenantScope,
): boolean => {
  if (scope.kind === "personal") return principal.userId === scope.userId;

  return principal.memberships.some(
    (membership) =>
      membership.active && membership.organizationId === scope.organizationId,
  );
};
