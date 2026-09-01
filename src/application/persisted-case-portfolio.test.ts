import { describe, expect, it, vi } from "vitest";

import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  PersonalCasePortfolio,
  PersistedCasePageValidationError,
  type PersistedCasePortfolioRepository,
  validatePersistedCasePage,
} from "./persisted-case-portfolio.js";

const TENANT_ID = "10000000-0000-7000-8000-000000000101";
const CASE_ID = "80000000-0000-7000-8000-000000000101";

describe("PersonalCasePortfolio", () => {
  it("resolves the trusted tenant and maps only its persisted case projection", async () => {
    const contextResolver = {
      resolve: vi.fn().mockResolvedValue({
        userId: "00000000-0000-7000-8000-000000000101",
        tenantId: TENANT_ID,
      }),
    } satisfies PersonalTenantContextResolver;
    const repository = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            tenantId: TENANT_ID,
            caseId: CASE_ID,
            cnjNumber: "0000001-23.2026.8.99.0101",
            tribunal: "TJZZ",
            identityStatus: "confirmed",
            lastUpdatedAt: new Date("2026-08-31T12:00:00.000Z"),
            sources: [
              {
                sourceId: "synthetic",
                official: false,
                collectedAt: new Date("2026-08-31T11:00:00.000Z"),
              },
            ],
          },
          {
            tenantId: "10000000-0000-7000-8000-000000000202",
            caseId: "80000000-0000-7000-8000-000000000202",
            cnjNumber: "0000002-23.2026.8.99.0202",
            tribunal: "TJZZ",
            identityStatus: "confirmed",
            lastUpdatedAt: new Date("2026-08-31T12:00:00.000Z"),
            sources: [],
          },
        ],
        nextCursor: CASE_ID,
      }),
    } satisfies PersistedCasePortfolioRepository;
    const service = new PersonalCasePortfolio(contextResolver, repository);

    await expect(
      service.list("provider-personal-synthetic", {
        limit: 20,
        afterCaseId: "70000000-0000-7000-8000-000000000001",
      }),
    ).resolves.toEqual({
      cases: [
        {
          caseId: CASE_ID,
          scope: {
            kind: "personal",
            userId: "provider-personal-synthetic",
          },
          cnjNumber: "0000001-23.2026.8.99.0101",
          tribunal: "TJZZ",
          identityStatus: "confirmed",
          lastUpdatedAt: "2026-08-31T12:00:00.000Z",
          sources: [
            {
              sourceId: "synthetic",
              official: false,
              collectedAt: "2026-08-31T11:00:00.000Z",
            },
          ],
          events: [],
        },
      ],
      nextCursor: CASE_ID,
    });
    expect(contextResolver.resolve).toHaveBeenCalledWith(
      "provider-personal-synthetic",
    );
    expect(repository.list).toHaveBeenCalledWith(
      {
        userId: "00000000-0000-7000-8000-000000000101",
        tenantId: TENANT_ID,
      },
      {
        limit: 20,
        afterCaseId: "70000000-0000-7000-8000-000000000001",
      },
    );
  });

  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: 20, afterCaseId: "invalid" },
  ])("rejects invalid pagination before resolving identity: %j", async (page) => {
    const resolver = {
      resolve: vi.fn(),
    } satisfies PersonalTenantContextResolver;
    const service = new PersonalCasePortfolio(resolver, {
      list: vi.fn(),
    });

    expect(() => validatePersistedCasePage(page)).toThrow(
      PersistedCasePageValidationError,
    );
    await expect(service.list("provider", page)).rejects.toBeInstanceOf(
      PersistedCasePageValidationError,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
