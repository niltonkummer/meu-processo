import { describe, expect, it, vi } from "vitest";

import {
  listPersistedCasesPage,
  SafePersistedPortfolioError,
  type PersistedPortfolioCase,
} from "./persisted-portfolio-client";

const persistedCase = {
  caseId: "83000000-0000-7000-8000-000000000801",
  cnjNumber: "0000001-23.2026.8.99.0801",
  tribunal: "TJZZ",
  identityStatus: "confirmed",
  lastUpdatedAt: "2026-08-31T10:01:00.000Z",
  sources: [{
    sourceId: "djen",
    official: true,
    collectedAt: "2026-08-31T10:00:00.000Z",
  }],
} satisfies PersistedPortfolioCase;

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("persisted portfolio client", () => {
  it("lists a strictly validated page using a UUID cursor", async () => {
    const nextCursor = "84000000-0000-7000-8000-000000000801";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      cases: [persistedCase],
      page: { nextCursor },
    }));

    await expect(listPersistedCasesPage(fetcher, "token", {
      limit: 20,
      afterCaseId: "82000000-0000-7000-8000-000000000801",
    })).resolves.toEqual({ items: [persistedCase], nextCursor });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/cases?limit=20&after=82000000-0000-7000-8000-000000000801",
      { headers: { authorization: "Bearer token" } },
    );
  });

  it("supports the first page without a cursor and both identity states", async () => {
    const possibleHomonym = {
      ...persistedCase,
      caseId: "83000000-0000-7000-8000-000000000802",
      cnjNumber: "0000002-23.2026.8.99.0802",
      identityStatus: "possible_homonym" as const,
      sources: [],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      cases: [possibleHomonym],
      page: { nextCursor: null },
    }));

    await expect(listPersistedCasesPage(fetcher, "token", { limit: 1 }))
      .resolves.toEqual({ items: [possibleHomonym], nextCursor: null });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/cases?limit=1", {
      headers: { authorization: "Bearer token" },
    });
  });

  it.each([
    ["non-object", "invalid"],
    ["array", []],
    ["extra field", { ...persistedCase, scope: { userId: "forbidden" } }],
    ["missing field", Object.fromEntries(Object.entries(persistedCase).slice(1))],
    ["case id", { ...persistedCase, caseId: "invalid" }],
    ["CNJ", { ...persistedCase, cnjNumber: "invalid" }],
    ["tribunal", { ...persistedCase, tribunal: "" }],
    ["identity", { ...persistedCase, identityStatus: "unverified" }],
    ["updated date", { ...persistedCase, lastUpdatedAt: "invalid" }],
    ["sources", { ...persistedCase, sources: Array.from({ length: 17 }, (_, index) => ({
      ...persistedCase.sources[0],
      sourceId: `source-${index}`,
    })) }],
    ["source id", { ...persistedCase, sources: [{ ...persistedCase.sources[0], sourceId: "" }] }],
    ["official", { ...persistedCase, sources: [{ ...persistedCase.sources[0], official: "yes" }] }],
    ["collected date", { ...persistedCase, sources: [{ ...persistedCase.sources[0], collectedAt: "invalid" }] }],
    ["source extra", { ...persistedCase, sources: [{ ...persistedCase.sources[0], url: "forbidden" }] }],
  ])("rejects an invalid case: %s", async (_name, invalid) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      cases: [invalid],
      page: { nextCursor: null },
    }));
    await expect(listPersistedCasesPage(fetcher, "token", { limit: 20 }))
      .rejects.toBeInstanceOf(SafePersistedPortfolioError);
  });

  it("rejects invalid envelopes, pages, duplicate cases and duplicate sources", async () => {
    for (const body of [
      { cases: "invalid", page: { nextCursor: null } },
      { cases: [], page: null },
      { cases: [], page: { nextCursor: "invalid" } },
      { cases: [], page: { nextCursor: null, extra: true } },
      { cases: [], page: { nextCursor: null }, protected: true },
      { cases: [persistedCase, persistedCase], page: { nextCursor: null } },
      { cases: [{ ...persistedCase, sources: [persistedCase.sources[0], persistedCase.sources[0]] }], page: { nextCursor: null } },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expect(listPersistedCasesPage(fetcher, "token", { limit: 20 }))
        .rejects.toBeInstanceOf(SafePersistedPortfolioError);
    }
  });

  it("rejects invalid requests without network access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const request of [
      { limit: 0 },
      { limit: 1.5 },
      { limit: 101 },
      { limit: 20, afterCaseId: "invalid" },
    ]) {
      await expect(listPersistedCasesPage(fetcher, "token", request))
        .rejects.toEqual(new SafePersistedPortfolioError(
          "INVALID_REQUEST",
          "Não foi possível montar a consulta da carteira.",
        ));
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("exposes only bounded API errors and rejects invalid JSON", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "CASE_PORTFOLIO_UNAVAILABLE",
      message: "Carteira temporariamente indisponível.",
    }, 503));
    await expect(listPersistedCasesPage(failed, "token", { limit: 20 }))
      .rejects.toEqual(new SafePersistedPortfolioError(
        "CASE_PORTFOLIO_UNAVAILABLE",
        "Carteira temporariamente indisponível.",
      ));

    for (const body of ["failed", { code: "X", message: "m".repeat(241) }]) {
      const unsafe = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, 500));
      await expect(listPersistedCasesPage(unsafe, "token", { limit: 20 }))
        .rejects.toEqual(new SafePersistedPortfolioError(
          "CASE_PORTFOLIO_FAILED",
          "Não foi possível carregar a carteira de processos.",
        ));
    }

    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", { status: 200 }),
    );
    await expect(listPersistedCasesPage(invalidJson, "token", { limit: 20 }))
      .rejects.toBeInstanceOf(SafePersistedPortfolioError);
  });
});
