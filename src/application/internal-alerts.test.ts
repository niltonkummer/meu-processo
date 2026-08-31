import { describe, expect, it, vi } from "vitest";

import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  AlertNotFoundError,
  AlertPageValidationError,
  PersonalAlerts,
  type AlertRepository,
} from "./internal-alerts.js";

const TENANT = "10000000-0000-7000-8000-000000000801";
const USER = "00000000-0000-7000-8000-000000000801";
const ALERT = "90000000-0000-7000-8000-000000000801";
const alert = {
  tenantId: TENANT,
  alertId: ALERT,
  subjectId: "20000000-0000-7000-8000-000000000801",
  subjectLabel: "Perfil sintético",
  tenantCaseId: "85000000-0000-7000-8000-000000000801",
  caseId: "83000000-0000-7000-8000-000000000801",
  caseEventId: "86000000-0000-7000-8000-000000000801",
  cnjNumber: "0000001-23.2026.8.99.0801",
  tribunal: "TJZZ",
  alertType: "case_discovered" as const,
  status: "unread" as const,
  matchStatus: "unverified" as const,
  sourceOccurredAt: new Date("2026-08-31T10:00:00.000Z"),
  createdAt: new Date("2026-08-31T10:01:00.000Z"),
  readAt: null,
};

const resolver = {
  resolve: vi.fn().mockResolvedValue({ userId: USER, tenantId: TENANT }),
} as unknown as PersonalTenantContextResolver;

describe("PersonalAlerts", () => {
  it("lists a tenant page and round-trips an opaque keyset cursor", async () => {
    const list = vi.fn<AlertRepository["list"]>().mockResolvedValue({
      items: [alert],
      next: { createdAt: alert.createdAt, alertId: ALERT },
    });
    const service = new PersonalAlerts(resolver, {
      list,
      markRead: vi.fn(),
    });

    const first = await service.list("firebase-user", {
      limit: 1,
      status: "unread",
    });
    expect(first.items).toEqual([{
      alertId: ALERT,
      subjectId: alert.subjectId,
      subjectLabel: alert.subjectLabel,
      tenantCaseId: alert.tenantCaseId,
      caseId: alert.caseId,
      caseEventId: alert.caseEventId,
      cnjNumber: alert.cnjNumber,
      tribunal: alert.tribunal,
      alertType: "case_discovered",
      status: "unread",
      matchStatus: "unverified",
      sourceOccurredAt: "2026-08-31T10:00:00.000Z",
      createdAt: "2026-08-31T10:01:00.000Z",
      readAt: null,
    }]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    await service.list("firebase-user", {
      limit: 1,
      status: "unread",
      cursor: first.nextCursor!,
    });
    expect(list).toHaveBeenLastCalledWith(
      { userId: USER, tenantId: TENANT },
      {
        limit: 1,
        status: "unread",
        after: { createdAt: alert.createdAt, alertId: ALERT },
      },
    );
  });

  it("marks an alert read idempotently with an injected clock", async () => {
    const read = { ...alert, status: "read" as const, readAt: new Date("2026-08-31T11:00:00.000Z") };
    const markRead = vi.fn<AlertRepository["markRead"]>().mockResolvedValue(read);
    const service = new PersonalAlerts(
      resolver,
      { list: vi.fn(), markRead },
      () => new Date("2026-08-31T11:00:00.000Z"),
    );

    await expect(service.markRead("firebase-user", ALERT)).resolves.toEqual({
      ...read,
      tenantId: undefined,
      sourceOccurredAt: "2026-08-31T10:00:00.000Z",
      createdAt: "2026-08-31T10:01:00.000Z",
      readAt: "2026-08-31T11:00:00.000Z",
    });
    expect(markRead).toHaveBeenCalledWith(
      { userId: USER, tenantId: TENANT },
      ALERT,
      new Date("2026-08-31T11:00:00.000Z"),
    );
  });

  it("fails closed for invalid pages, IDs, clocks and cross-tenant projections", async () => {
    const repository: AlertRepository = {
      list: vi.fn().mockResolvedValue({
        items: [{ ...alert, tenantId: "10000000-0000-7000-8000-000000000802" }],
        next: null,
      }),
      markRead: vi.fn().mockResolvedValue(null),
    };
    const service = new PersonalAlerts(resolver, repository);
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { limit: 20, status: "deleted" },
      { limit: 20, cursor: "not-a-valid-cursor" },
    ]) {
      await expect(service.list("firebase-user", input as never)).rejects.toBeInstanceOf(
        AlertPageValidationError,
      );
    }
    await expect(service.list("firebase-user", { limit: 20 })).rejects.toBeInstanceOf(
      AlertNotFoundError,
    );
    await expect(service.markRead("firebase-user", "bad-id")).rejects.toBeInstanceOf(
      AlertPageValidationError,
    );
    await expect(service.markRead("firebase-user", ALERT)).rejects.toBeInstanceOf(
      AlertNotFoundError,
    );

    const invalidClock = new PersonalAlerts(resolver, repository, () => new Date("invalid"));
    await expect(invalidClock.markRead("firebase-user", ALERT)).rejects.toBeInstanceOf(
      AlertPageValidationError,
    );
  });

  it("validates every opaque cursor field and maps an empty terminal page", async () => {
    const repository: AlertRepository = {
      list: vi.fn().mockResolvedValue({ items: [], next: null }),
      markRead: vi.fn().mockResolvedValue({
        ...alert,
        tenantId: "10000000-0000-7000-8000-000000000802",
      }),
    };
    const service = new PersonalAlerts(resolver, repository);
    await expect(service.list("firebase-user", { limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    const encoded = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    for (const cursor of [
      "________",
      encoded(null),
      encoded([]),
      encoded("text"),
      encoded({ v: 1, at: alert.createdAt.toISOString(), id: ALERT, extra: true }),
      encoded({ v: 2, at: alert.createdAt.toISOString(), id: ALERT }),
      encoded({ v: 1, at: 1, id: ALERT }),
      encoded({ v: 1, at: "invalid", id: ALERT }),
      encoded({ v: 1, at: alert.createdAt.toISOString(), id: 1 }),
      encoded({ v: 1, at: alert.createdAt.toISOString(), id: "bad-id" }),
    ]) {
      await expect(
        service.list("firebase-user", { limit: 20, cursor }),
      ).rejects.toBeInstanceOf(AlertPageValidationError);
    }
    await expect(service.markRead("firebase-user", ALERT)).rejects.toBeInstanceOf(
      AlertNotFoundError,
    );
  });
});
