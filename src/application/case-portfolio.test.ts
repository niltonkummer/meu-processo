import { describe, expect, it, vi } from "vitest";

import type {
  AuthenticatedPrincipal,
  TenantScope,
} from "../domain/access-control.js";
import {
  getAuthorizedCase,
  listAuthorizedCases,
  PortfolioAccessDeniedError,
  PortfolioCaseNotFoundError,
  type CanonicalCase,
  type CaseRepository,
} from "./case-portfolio.js";

const personalScope: TenantScope = { kind: "personal", userId: "user_alpha" };
const foreignScope: TenantScope = { kind: "personal", userId: "user_beta" };
const organizationScope: TenantScope = {
  kind: "organization",
  organizationId: "org_alpha",
};

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [
    { organizationId: "org_alpha", role: "viewer", active: true },
  ],
};

const ownCase: CanonicalCase = {
  caseId: "case_alpha",
  scope: personalScope,
  cnjNumber: "0000001-23.2026.8.99.0001",
  tribunal: "TJEX",
  organ: "Vara de Exemplo",
  className: "Classe de Exemplo",
  identityStatus: "confirmed",
  lastUpdatedAt: "2026-08-29T12:00:00.000Z",
  sources: [
    {
      sourceId: "DJEN",
      official: true,
      collectedAt: "2026-08-29T12:00:00.000Z",
    },
  ],
  events: [],
};

const foreignCase: CanonicalCase = {
  ...ownCase,
  caseId: "case_beta",
  scope: foreignScope,
  cnjNumber: "0000002-23.2026.8.99.0001",
};

describe("case portfolio", () => {
  it("filters a leaky repository response by the authorized scope", async () => {
    const repository: CaseRepository = {
      list: vi.fn().mockResolvedValue([ownCase, foreignCase]),
      findById: vi.fn(),
    };

    await expect(
      listAuthorizedCases(principal, personalScope, repository),
    ).resolves.toEqual([ownCase]);
    expect(repository.list).toHaveBeenCalledWith(personalScope);
  });

  it("allows an active organization member to read the organization portfolio", async () => {
    const organizationCase: CanonicalCase = {
      ...ownCase,
      caseId: "case_org",
      scope: organizationScope,
    };
    const repository: CaseRepository = {
      list: vi.fn().mockResolvedValue([organizationCase]),
      findById: vi.fn(),
    };

    await expect(
      listAuthorizedCases(principal, organizationScope, repository),
    ).resolves.toEqual([organizationCase]);
  });

  it("denies an unauthorized scope before querying the repository", async () => {
    const repository: CaseRepository = {
      list: vi.fn(),
      findById: vi.fn(),
    };

    await expect(
      listAuthorizedCases(principal, foreignScope, repository),
    ).rejects.toBeInstanceOf(PortfolioAccessDeniedError);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("returns a case only when both id and scope match", async () => {
    const repository: CaseRepository = {
      list: vi.fn(),
      findById: vi
        .fn()
        .mockResolvedValueOnce(ownCase)
        .mockResolvedValueOnce(foreignCase)
        .mockResolvedValueOnce(undefined),
    };

    await expect(
      getAuthorizedCase(principal, personalScope, "case_alpha", repository),
    ).resolves.toEqual(ownCase);
    await expect(
      getAuthorizedCase(principal, personalScope, "case_beta", repository),
    ).rejects.toBeInstanceOf(PortfolioCaseNotFoundError);
    await expect(
      getAuthorizedCase(principal, personalScope, "case_missing", repository),
    ).rejects.toBeInstanceOf(PortfolioCaseNotFoundError);
  });

  it("denies case detail access before querying a foreign scope", async () => {
    const repository: CaseRepository = {
      list: vi.fn(),
      findById: vi.fn(),
    };

    await expect(
      getAuthorizedCase(principal, foreignScope, "case_beta", repository),
    ).rejects.toBeInstanceOf(PortfolioAccessDeniedError);
    expect(repository.findById).not.toHaveBeenCalled();
  });
});
