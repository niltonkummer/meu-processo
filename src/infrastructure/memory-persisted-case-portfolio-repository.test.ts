import { describe, expect, it } from "vitest";

import type { PersistedCaseRecord } from "../application/persisted-case-portfolio.js";
import { MemoryPersistedCasePortfolioRepository } from "./memory-persisted-case-portfolio-repository.js";

const record = (
  tenantId: string,
  caseId: string,
): PersistedCaseRecord => ({
  tenantId,
  caseId,
  cnjNumber: "0000001-23.2026.8.99.0001",
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
});

describe("MemoryPersistedCasePortfolioRepository", () => {
  it("paginates in stable order without leaking another tenant", async () => {
    const tenantId = "10000000-0000-7000-8000-000000000101";
    const firstId = "80000000-0000-7000-8000-000000000101";
    const secondId = "80000000-0000-7000-8000-000000000102";
    const repository = new MemoryPersistedCasePortfolioRepository([
      record(tenantId, secondId),
      record("10000000-0000-7000-8000-000000000202", firstId),
      record(tenantId, firstId),
    ]);
    const context = {
      userId: "00000000-0000-7000-8000-000000000101",
      tenantId,
    };

    const first = await repository.list(context, { limit: 1 });
    expect(first.items.map((item) => item.caseId)).toEqual([firstId]);
    expect(first.nextCursor).toBe(firstId);
    const second = await repository.list(context, {
      limit: 1,
      afterCaseId: first.nextCursor!,
    });
    expect(second.items.map((item) => item.caseId)).toEqual([secondId]);
    expect(second.nextCursor).toBeNull();

    const mutable = second.items as PersistedCaseRecord[];
    mutable[0]!.lastUpdatedAt.setUTCFullYear(2030);
    const repeated = await repository.list(context, {
      limit: 1,
      afterCaseId: firstId,
    });
    expect(repeated.items[0]!.lastUpdatedAt.getUTCFullYear()).toBe(2026);
  });

  it("returns an empty page for a tenant without cases", async () => {
    const repository = new MemoryPersistedCasePortfolioRepository();
    await expect(
      repository.list(
        {
          userId: "00000000-0000-7000-8000-000000000303",
          tenantId: "10000000-0000-7000-8000-000000000303",
        },
        { limit: 20 },
      ),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
});
