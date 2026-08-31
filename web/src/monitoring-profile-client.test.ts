import { describe, expect, it, vi } from "vitest";

import {
  archiveMonitoringProfile,
  createMonitoringProfile,
  listMonitoringProfiles,
  type MonitoringProfile,
  SafeMonitoringProfileError,
} from "./monitoring-profile-client";

const subject = {
  subjectId: "20000000-0000-8000-8000-000000000001",
  subjectType: "name",
  displayLabel: "P. S.",
  status: "active",
  version: 1,
  archivedAt: null,
} satisfies MonitoringProfile;

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("monitoring profile client", () => {
  it("lists only the validated account projection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ items: [subject], nextCursor: null }),
    );

    await expect(
      listMonitoringProfiles(fetcher, "firebase-token"),
    ).resolves.toEqual([subject]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/monitoring/subjects?limit=100",
      {
        headers: { authorization: "Bearer firebase-token" },
      },
    );
  });

  it("loads every page before presenting the account projection", async () => {
    const secondSubject = {
      ...subject,
      subjectId: "20000000-0000-8000-8000-000000000002",
      displayLabel: "E. S.",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: [subject], nextCursor: subject.subjectId }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [secondSubject], nextCursor: null }),
      );

    await expect(
      listMonitoringProfiles(fetcher, "firebase-token"),
    ).resolves.toEqual([subject, secondSubject]);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/monitoring/subjects?limit=100&after=${subject.subjectId}`,
      {
        headers: { authorization: "Bearer firebase-token" },
      },
    );
  });

  it("rejects repeated cursors and duplicate profiles instead of returning partial data", async () => {
    const secondSubject = {
      ...subject,
      subjectId: "20000000-0000-8000-8000-000000000002",
    };
    const repeatedCursor = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: [subject], nextCursor: subject.subjectId }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [secondSubject], nextCursor: subject.subjectId }),
      );
    await expect(
      listMonitoringProfiles(repeatedCursor, "firebase-token"),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);

    const duplicateProfile = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: [subject], nextCursor: subject.subjectId }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [subject], nextCursor: null }),
      );
    await expect(
      listMonitoringProfiles(duplicateProfile, "firebase-token"),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);
  });

  it("rejects an unbounded profile listing", async () => {
    let page = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
      page += 1;
      const pageSubject = {
        ...subject,
        subjectId: `20000000-0000-8000-8000-${String(page).padStart(12, "0")}`,
      };
      return Promise.resolve(
        jsonResponse({ items: [pageSubject], nextCursor: pageSubject.subjectId }),
      );
    });

    await expect(
      listMonitoringProfiles(fetcher, "firebase-token"),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);
    expect(fetcher).toHaveBeenCalledTimes(100);
  });

  it("creates a protected profile without persisting its plaintext client-side", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ subject }, 201),
    );

    await expect(
      createMonitoringProfile(fetcher, "firebase-token", {
        type: "name",
        value: "Pessoa Sintética",
      }),
    ).resolves.toEqual(subject);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/monitoring/subjects", {
      method: "POST",
      headers: {
        authorization: "Bearer firebase-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "name", value: "Pessoa Sintética" }),
    });
  });

  it("archives with an optimistic-concurrency validator", async () => {
    const archived = {
      ...subject,
      status: "inactive",
      version: 2,
      archivedAt: "2026-08-30T12:00:00.000Z",
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ subject: archived }),
    );

    await expect(
      archiveMonitoringProfile(fetcher, "firebase-token", subject),
    ).resolves.toEqual(archived);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/monitoring/subjects/${subject.subjectId}`,
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer firebase-token",
          "if-match": '"1"',
        },
      },
    );
  });

  it("rejects malformed or protected payloads and exposes only safe API errors", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [{ ...subject, encryptedValue: "must-not-reach-browser" }],
        nextCursor: null,
      }),
    );
    await expect(
      listMonitoringProfiles(malformed, "firebase-token"),
    ).rejects.toEqual(
      new SafeMonitoringProfileError(
        "INVALID_RESPONSE",
        "O servidor retornou uma resposta inesperada.",
      ),
    );

    const failed = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { code: "MONITORING_PROFILE_CONFLICT", message: "O perfil já existe." },
        409,
      ),
    );
    await expect(
      createMonitoringProfile(failed, "firebase-token", {
        type: "cpf",
        value: "123.456.789-09",
      }),
    ).rejects.toEqual(
      new SafeMonitoringProfileError(
        "MONITORING_PROFILE_CONFLICT",
        "O perfil já existe.",
      ),
    );
  });

  it.each([
    ["non-object", "invalid"],
    ["null", null],
    ["array", []],
    ["extra field", { ...subject, protectedReference: "forbidden" }],
    [
      "missing field",
      {
        subjectId: subject.subjectId,
        subjectType: subject.subjectType,
        displayLabel: subject.displayLabel,
        status: subject.status,
        version: subject.version,
      },
    ],
    ["non-string id", { ...subject, subjectId: 12 }],
    ["invalid id", { ...subject, subjectId: "not-a-uuid" }],
    ["invalid type", { ...subject, subjectType: "email" }],
    ["non-string label", { ...subject, displayLabel: 12 }],
    ["empty label", { ...subject, displayLabel: "" }],
    ["oversized label", { ...subject, displayLabel: "A".repeat(81) }],
    ["invalid status", { ...subject, status: "pending" }],
    ["non-integer version", { ...subject, version: "1" }],
    ["zero version", { ...subject, version: 0 }],
    ["non-string archive date", { ...subject, archivedAt: 12 }],
    ["invalid archive date", { ...subject, archivedAt: "not-a-date" }],
  ])("rejects an invalid profile: %s", async (_name, invalidProfile) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ items: [invalidProfile], nextCursor: null }),
    );

    await expect(
      listMonitoringProfiles(fetcher, "firebase-token"),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);
  });

  it.each([
    { items: "not-an-array", nextCursor: null },
    { items: [], nextCursor: 12 },
    { items: [], nextCursor: "not-a-uuid" },
    { items: [], nextCursor: null, unexpected: true },
  ])("rejects an invalid page envelope", async (page) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(page));
    await expect(
      listMonitoringProfiles(fetcher, "firebase-token"),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);
  });

  it("rejects invalid JSON and malformed success envelopes", async () => {
    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      listMonitoringProfiles(invalidJson, "firebase-token"),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);

    const extraCreate = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ subject, unexpected: true }, 201),
    );
    await expect(
      createMonitoringProfile(extraCreate, "firebase-token", {
        type: "name",
        value: "Pessoa Sintética",
      }),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);

    const extraArchive = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ subject, unexpected: true }),
    );
    await expect(
      archiveMonitoringProfile(extraArchive, "firebase-token", subject),
    ).rejects.toBeInstanceOf(SafeMonitoringProfileError);
  });

  it.each([
    ["primitive", "error"],
    ["null", null],
    ["array", []],
    ["missing fields", {}],
    ["non-string code", { code: 12, message: "Falha" }],
    ["empty code", { code: "", message: "Falha" }],
    ["oversized code", { code: "A".repeat(81), message: "Falha" }],
    ["non-string message", { code: "FAILED", message: 12 }],
    ["empty message", { code: "FAILED", message: "" }],
    ["oversized message", { code: "FAILED", message: "A".repeat(241) }],
  ])("falls back for a malformed API error: %s", async (_name, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(body, 500),
    );
    await expect(
      createMonitoringProfile(fetcher, "firebase-token", {
        type: "cnpj",
        value: "11.222.333/0001-81",
      }),
    ).rejects.toEqual(
      new SafeMonitoringProfileError(
        "MONITORING_PROFILE_FAILED",
        "Não foi possível atualizar seus perfis monitorados.",
      ),
    );
  });

  it("maps list and archive API failures", async () => {
    const failure = {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    };
    const listFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(failure, 401),
    );
    const archiveFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(failure, 401),
    );

    await expect(
      listMonitoringProfiles(listFetcher, "firebase-token"),
    ).rejects.toEqual(
      new SafeMonitoringProfileError(failure.code, failure.message),
    );
    await expect(
      archiveMonitoringProfile(archiveFetcher, "firebase-token", subject),
    ).rejects.toEqual(
      new SafeMonitoringProfileError(failure.code, failure.message),
    );
  });
});
