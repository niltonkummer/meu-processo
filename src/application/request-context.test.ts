import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import {
  createRequestContext,
  RequestContextAccessDeniedError,
} from "./request-context.js";

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [
    { organizationId: "org_active", role: "lawyer", active: true },
    { organizationId: "org_inactive", role: "viewer", active: false },
  ],
};

const now = new Date("2026-08-30T12:00:00.000Z");

describe("request context", () => {
  it("creates a personal context from the verified principal", () => {
    const createId = vi.fn().mockReturnValue("request_alpha");

    expect(
      createRequestContext({
        principal,
        clock: { now: () => now },
        createId,
      }),
    ).toEqual({
      requestId: "request_alpha",
      correlationId: "request_alpha",
      principal,
      tenantScope: { kind: "personal", userId: "user_alpha" },
      receivedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(createId).toHaveBeenCalledOnce();
  });

  it("selects an organization only from an active membership", () => {
    expect(
      createRequestContext({
        principal,
        requestedOrganizationId: "org_active",
        suppliedCorrelationId: "correlation-safe_123",
        clock: { now: () => now },
        createId: () => "request_beta",
      }),
    ).toMatchObject({
      requestId: "request_beta",
      correlationId: "correlation-safe_123",
      tenantScope: { kind: "organization", organizationId: "org_active" },
    });
  });

  it.each(["org_inactive", "org_unknown"])(
    "denies organization %s without an active membership",
    (organizationId) => {
      expect(() =>
        createRequestContext({
          principal,
          requestedOrganizationId: organizationId,
          clock: { now: () => now },
          createId: () => "request_denied",
        }),
      ).toThrow(RequestContextAccessDeniedError);
    },
  );

  it("does not trust an unsafe supplied correlation identifier", () => {
    expect(
      createRequestContext({
        principal,
        suppliedCorrelationId: "contains sensitive spaces",
        clock: { now: () => now },
        createId: () => "request_gamma",
      }).correlationId,
    ).toBe("request_gamma");
  });
});
