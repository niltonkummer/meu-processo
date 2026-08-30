import { describe, expect, it } from "vitest";

import type { CanonicalCase } from "../application/case-portfolio.js";
import { MemoryCaseRepository } from "./memory-case-repository.js";

const personalCase: CanonicalCase = {
  caseId: "case_alpha",
  scope: { kind: "personal", userId: "user_alpha" },
  cnjNumber: "0000001-23.2026.8.99.0001",
  tribunal: "TJEX",
  identityStatus: "confirmed",
  lastUpdatedAt: "2026-08-29T12:00:00.000Z",
  sources: [],
  events: [],
};

const organizationCase: CanonicalCase = {
  ...personalCase,
  caseId: "case_org",
  scope: { kind: "organization", organizationId: "org_alpha" },
};

describe("MemoryCaseRepository", () => {
  it("isolates list and detail reads by tenant scope", async () => {
    const repository = new MemoryCaseRepository([personalCase, organizationCase]);

    await expect(
      repository.list({ kind: "personal", userId: "user_alpha" }),
    ).resolves.toEqual([personalCase]);
    await expect(
      repository.findById(
        { kind: "organization", organizationId: "org_alpha" },
        "case_org",
      ),
    ).resolves.toEqual(organizationCase);
    await expect(
      repository.findById(
        { kind: "personal", userId: "user_alpha" },
        "case_org",
      ),
    ).resolves.toBeUndefined();
  });

  it("upserts only the matching scoped record and does not expose internal storage", async () => {
    const repository = new MemoryCaseRepository([personalCase]);
    const updated: CanonicalCase = {
      ...personalCase,
      tribunal: "TJEX atualizado",
    };

    repository.upsert(updated);
    const listed = await repository.list(personalCase.scope);
    expect(listed).toEqual([updated]);

    const mutableCopy = listed as CanonicalCase[];
    mutableCopy.splice(0, 1);
    await expect(repository.list(personalCase.scope)).resolves.toEqual([updated]);
  });

  it("adds a new scoped record when no composite identity exists", async () => {
    const repository = new MemoryCaseRepository();
    repository.upsert(organizationCase);

    await expect(repository.list(organizationCase.scope)).resolves.toEqual([
      organizationCase,
    ]);
  });
});
