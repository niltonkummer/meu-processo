import { describe, expect, it, vi } from "vitest";

import {
  listAlertsPage,
  listCaseTimelinePage,
  markAlertRead,
  SafeCaseActivityError,
  type CaseAlert,
  type CaseTimelineEvent,
} from "./case-activity-client";

const alert = {
  alertId: "90000000-0000-7000-8000-000000000801",
  subjectId: "20000000-0000-7000-8000-000000000801",
  subjectLabel: "P. S.",
  tenantCaseId: "85000000-0000-7000-8000-000000000801",
  caseId: "83000000-0000-7000-8000-000000000801",
  caseEventId: "86000000-0000-7000-8000-000000000801",
  cnjNumber: "0000001-23.2026.8.99.0801",
  tribunal: "TJZZ",
  alertType: "case_discovered",
  status: "unread",
  matchStatus: "unverified",
  sourceOccurredAt: "2026-08-31T10:00:00.000Z",
  createdAt: "2026-08-31T10:01:00.000Z",
  readAt: null,
} satisfies CaseAlert;

const event = {
  eventId: alert.caseEventId,
  caseId: alert.caseId,
  eventType: "publication",
  occurredAt: "2026-08-31T10:00:00.000Z",
  title: "Publicação localizada",
  description: "Trecho processual decodificado.",
  sources: [
    {
      sourceId: "40000000-0000-7000-8000-000000000801",
      official: true,
      collectedAt: "2026-08-31T10:01:00.000Z",
    },
  ],
} satisfies CaseTimelineEvent;

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("case activity client", () => {
  it("lists a validated alert page with an opaque cursor", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ items: [alert], nextCursor: "eyJ2IjoxfQ" }),
    );

    await expect(listAlertsPage(fetcher, "token", {
      limit: 20,
      status: "unread",
      cursor: "cursor_safe-1",
    })).resolves.toEqual({ items: [alert], nextCursor: "eyJ2IjoxfQ" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/alerts?limit=20&status=unread&cursor=cursor_safe-1",
      { headers: { authorization: "Bearer token" } },
    );
  });

  it("marks exactly one alert read", async () => {
    const readAlert = {
      ...alert,
      status: "read" as const,
      readAt: "2026-08-31T10:05:00.000Z",
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ alert: readAlert }),
    );

    await expect(markAlertRead(fetcher, "token", alert.alertId))
      .resolves.toEqual(readAlert);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/alerts/${alert.alertId}/read`,
      { method: "PATCH", headers: { authorization: "Bearer token" } },
    );
  });

  it("lists only events belonging to the requested case", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ events: [event], page: { nextCursor: "timeline_1" } }),
    );

    await expect(listCaseTimelinePage(fetcher, "token", alert.caseId, {
      limit: 20,
      cursor: "timeline_0",
    })).resolves.toEqual({ items: [event], nextCursor: "timeline_1" });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/cases/${alert.caseId}/events?limit=20&cursor=timeline_0`,
      { headers: { authorization: "Bearer token" } },
    );
  });

  it("exposes only bounded safe API errors and rejects invalid JSON", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: "ALERTS_UNAVAILABLE", message: "Alertas indisponíveis." }, 503),
    );
    await expect(listAlertsPage(failed, "token", { limit: 20, status: "all" }))
      .rejects.toEqual(new SafeCaseActivityError(
        "ALERTS_UNAVAILABLE",
        "Alertas indisponíveis.",
      ));

    const unsafe = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: "X", message: "m".repeat(241) }, 500),
    );
    await expect(listAlertsPage(unsafe, "token", { limit: 20, status: "all" }))
      .rejects.toEqual(new SafeCaseActivityError(
        "CASE_ACTIVITY_FAILED",
        "Não foi possível carregar o acompanhamento.",
      ));

    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", { status: 200 }),
    );
    await expect(listAlertsPage(invalidJson, "token", { limit: 20, status: "all" }))
      .rejects.toBeInstanceOf(SafeCaseActivityError);
  });

  it.each([
    ["non-object", "invalid"],
    ["array", []],
    ["extra field", { ...alert, encryptedValue: "forbidden" }],
    ["missing field", Object.fromEntries(Object.entries(alert).slice(1))],
    ["alert id", { ...alert, alertId: "invalid" }],
    ["subject id", { ...alert, subjectId: "invalid" }],
    ["subject label", { ...alert, subjectLabel: "" }],
    ["tenant case id", { ...alert, tenantCaseId: "invalid" }],
    ["case id", { ...alert, caseId: "invalid" }],
    ["case event id", { ...alert, caseEventId: "invalid" }],
    ["CNJ", { ...alert, cnjNumber: "invalid" }],
    ["tribunal", { ...alert, tribunal: "" }],
    ["alert type", { ...alert, alertType: "movement" }],
    ["status", { ...alert, status: "pending" }],
    ["match status", { ...alert, matchStatus: "confirmed" }],
    ["source date", { ...alert, sourceOccurredAt: "invalid" }],
    ["created date", { ...alert, createdAt: 12 }],
    ["read date", { ...alert, readAt: "invalid" }],
    ["unread with read date", { ...alert, readAt: "2026-08-31T10:05:00.000Z" }],
    ["read without read date", { ...alert, status: "read" }],
  ])("rejects an invalid alert: %s", async (_name, invalid) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ items: [invalid], nextCursor: null }),
    );
    await expect(listAlertsPage(fetcher, "token", { limit: 20, status: "all" }))
      .rejects.toBeInstanceOf(SafeCaseActivityError);
  });

  it("rejects invalid alert envelopes, duplicates and cursors", async () => {
    for (const body of [
      { items: "invalid", nextCursor: null },
      { items: [], nextCursor: 12 },
      { items: [], nextCursor: "bad cursor!" },
      { items: [], nextCursor: null, protected: true },
      { items: [alert, alert], nextCursor: null },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expect(listAlertsPage(fetcher, "token", { limit: 20, status: "all" }))
        .rejects.toBeInstanceOf(SafeCaseActivityError);
    }
  });

  it.each([
    ["non-object", "invalid"],
    ["extra field", { ...event, html: "<p>forbidden</p>" }],
    ["event id", { ...event, eventId: "invalid" }],
    ["foreign case", { ...event, caseId: "83000000-0000-7000-8000-000000000999" }],
    ["event type", { ...event, eventType: "movement" }],
    ["date", { ...event, occurredAt: "invalid" }],
    ["title", { ...event, title: "" }],
    ["description", { ...event, description: 12 }],
    ["sources", { ...event, sources: "invalid" }],
    ["source id", { ...event, sources: [{ ...event.sources[0], sourceId: "" }] }],
    ["official", { ...event, sources: [{ ...event.sources[0], official: "yes" }] }],
    ["collected date", { ...event, sources: [{ ...event.sources[0], collectedAt: "invalid" }] }],
    ["source extra", { ...event, sources: [{ ...event.sources[0], url: "forbidden" }] }],
  ])("rejects an invalid timeline event: %s", async (_name, invalid) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ events: [invalid], page: { nextCursor: null } }),
    );
    await expect(listCaseTimelinePage(fetcher, "token", alert.caseId, { limit: 20 }))
      .rejects.toBeInstanceOf(SafeCaseActivityError);
  });

  it("rejects invalid timeline envelopes, duplicate events and sources", async () => {
    for (const body of [
      { events: "invalid", page: { nextCursor: null } },
      { events: [], page: null },
      { events: [], page: { nextCursor: "bad cursor!" } },
      { events: [], page: { nextCursor: null, extra: true } },
      { events: [event, event], page: { nextCursor: null } },
      { events: [{ ...event, sources: [event.sources[0], event.sources[0]] }], page: { nextCursor: null } },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expect(listCaseTimelinePage(fetcher, "token", alert.caseId, { limit: 20 }))
        .rejects.toBeInstanceOf(SafeCaseActivityError);
    }
  });

  it("rejects malformed success wrappers for mark-read", async () => {
    for (const body of [alert, { alert, extra: true }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expect(markAlertRead(fetcher, "token", alert.alertId))
        .rejects.toBeInstanceOf(SafeCaseActivityError);
    }
  });

  it("rejects invalid requests before network access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const request of [
      { limit: 1.5, status: "all" as const },
      { limit: 0, status: "all" as const },
      { limit: 101, status: "all" as const },
      { limit: 20, status: "all" as const, cursor: "bad!" },
      { limit: 20, status: "invalid" as "all" },
    ]) {
      await expect(listAlertsPage(fetcher, "token", request))
        .rejects.toEqual(new SafeCaseActivityError(
          "INVALID_REQUEST",
          "Não foi possível montar a consulta de acompanhamento.",
        ));
    }
    await expect(markAlertRead(fetcher, "token", "invalid"))
      .rejects.toBeInstanceOf(SafeCaseActivityError);
    await expect(listCaseTimelinePage(fetcher, "token", "invalid", { limit: 20 }))
      .rejects.toBeInstanceOf(SafeCaseActivityError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("handles failures on every activity endpoint and rejects a substituted read result", async () => {
    const nonObject = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse("failed", 500));
    await expect(listAlertsPage(nonObject, "token", { limit: 20, status: "all" }))
      .rejects.toEqual(new SafeCaseActivityError(
        "CASE_ACTIVITY_FAILED",
        "Não foi possível carregar o acompanhamento.",
      ));

    const markFailed = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: "ALERT_FAILED", message: "Falha segura." }, 503),
    );
    await expect(markAlertRead(markFailed, "token", alert.alertId))
      .rejects.toEqual(new SafeCaseActivityError("ALERT_FAILED", "Falha segura."));

    const timelineFailed = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: "TIMELINE_FAILED", message: "Falha segura." }, 503),
    );
    await expect(listCaseTimelinePage(
      timelineFailed,
      "token",
      alert.caseId,
      { limit: 20 },
    )).rejects.toEqual(new SafeCaseActivityError("TIMELINE_FAILED", "Falha segura."));

    const substituted = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      alert: {
        ...alert,
        alertId: "90000000-0000-7000-8000-000000000999",
      },
    }));
    await expect(markAlertRead(substituted, "token", alert.alertId))
      .rejects.toBeInstanceOf(SafeCaseActivityError);
  });
});
