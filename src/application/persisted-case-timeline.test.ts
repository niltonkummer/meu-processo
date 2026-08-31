import { describe, expect, it, vi } from "vitest";

import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  CaseTimelineNotFoundError,
  CaseTimelinePageValidationError,
  PersonalCaseTimeline,
  type PersistedCaseTimelineRepository,
} from "./persisted-case-timeline.js";

const USER = "00000000-0000-7000-8000-000000000901";
const TENANT = "10000000-0000-7000-8000-000000000901";
const CASE = "83000000-0000-7000-8000-000000000901";
const EVENT = "86000000-0000-7000-8000-000000000901";
const occurredAt = new Date("2026-08-31T09:00:00.000Z");
const item = {
  tenantId: TENANT,
  caseEventId: EVENT,
  caseId: CASE,
  eventType: "publication" as const,
  occurredAt,
  title: "Intimação publicada",
  plainTextExcerpt: "Trecho seguro & decodificado.",
  sources: [{
    sourceId: "synthetic-worker",
    official: false,
    collectedAt: new Date("2026-08-31T10:00:00.000Z"),
  }],
};
const resolver = {
  resolve: vi.fn().mockResolvedValue({ userId: USER, tenantId: TENANT }),
} as unknown as PersonalTenantContextResolver;

describe("PersonalCaseTimeline", () => {
  it("maps an authorized event and round-trips its opaque keyset cursor", async () => {
    const list = vi.fn<PersistedCaseTimelineRepository["list"]>()
      .mockResolvedValue({ caseFound: true, items: [item], next: { occurredAt, caseEventId: EVENT } });
    const service = new PersonalCaseTimeline(resolver, { list });
    const first = await service.list("provider-user", CASE, { limit: 1 });
    expect(first.items).toEqual([{
      eventId: EVENT,
      caseId: CASE,
      eventType: "publication",
      occurredAt: "2026-08-31T09:00:00.000Z",
      title: "Intimação publicada",
      description: "Trecho seguro & decodificado.",
      sources: [{
        sourceId: "synthetic-worker",
        official: false,
        collectedAt: "2026-08-31T10:00:00.000Z",
      }],
    }]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    await service.list("provider-user", CASE, { limit: 1, cursor: first.nextCursor! });
    expect(list).toHaveBeenLastCalledWith(
      { userId: USER, tenantId: TENANT },
      CASE,
      { limit: 1, after: { occurredAt, caseEventId: EVENT } },
    );
  });

  it("returns an empty terminal timeline only for an existing case", async () => {
    const repository: PersistedCaseTimelineRepository = {
      list: vi.fn().mockResolvedValue({ caseFound: true, items: [], next: null }),
    };
    const service = new PersonalCaseTimeline(resolver, repository);
    await expect(service.list("provider-user", CASE, { limit: 20 })).resolves.toEqual({
      items: [], nextCursor: null,
    });
  });

  it("fails closed for invalid input, cursors, missing cases and leaked tenants", async () => {
    const repository: PersistedCaseTimelineRepository = {
      list: vi.fn().mockResolvedValue({ caseFound: false, items: [], next: null }),
    };
    const service = new PersonalCaseTimeline(resolver, repository);
    for (const request of [
      { caseId: "bad", page: { limit: 20 } },
      { caseId: CASE, page: { limit: 0 } },
      { caseId: CASE, page: { limit: 101 } },
      { caseId: CASE, page: { limit: 20, cursor: "invalid--" } },
    ]) {
      await expect(service.list("provider", request.caseId, request.page))
        .rejects.toBeInstanceOf(CaseTimelinePageValidationError);
    }
    await expect(service.list("provider", CASE, { limit: 20 }))
      .rejects.toBeInstanceOf(CaseTimelineNotFoundError);

    const leaking = new PersonalCaseTimeline(resolver, {
      list: vi.fn().mockResolvedValue({
        caseFound: true,
        items: [{ ...item, tenantId: "10000000-0000-7000-8000-000000000902" }],
        next: null,
      }),
    });
    await expect(leaking.list("provider", CASE, { limit: 20 }))
      .rejects.toBeInstanceOf(CaseTimelineNotFoundError);
  });

  it("rejects malformed cursor JSON and every invalid cursor field", async () => {
    const service = new PersonalCaseTimeline(resolver, {
      list: vi.fn().mockResolvedValue({ caseFound: true, items: [], next: null }),
    });
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const rawEncoded = (value: string) =>
      Buffer.from(value, "utf8").toString("base64url");
    for (const cursor of [
      "bad!", "________", rawEncoded("null       "), encoded([1, 2, 3]), encoded("long-text-value"),
      encoded({ v: 1, at: occurredAt.toISOString(), id: EVENT, extra: 1 }),
      encoded({ v: 2, at: occurredAt.toISOString(), id: EVENT }),
      encoded({ v: 1, at: 1, id: EVENT }),
      encoded({ v: 1, at: "invalid", id: EVENT }),
      encoded({ v: 1, at: occurredAt.toISOString(), id: 1 }),
      encoded({ v: 1, at: occurredAt.toISOString(), id: "bad" }),
    ]) {
      await expect(service.list("provider", CASE, { limit: 20, cursor }))
        .rejects.toBeInstanceOf(CaseTimelinePageValidationError);
    }
  });
});
