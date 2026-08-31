import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityCenter } from "./ActivityCenter";
import type { AuthenticatedWebSession } from "./auth-client";
import type { CaseAlert, CaseTimelineEvent } from "./case-activity-client";
import type { PersistedPortfolioCase } from "./persisted-portfolio-client";
import type { PersistedCaseDocument } from "./persisted-document-client";

const session: AuthenticatedWebSession = {
  email: "pessoa@example.test",
  getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
};

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

const timelineEvent = {
  eventId: alert.caseEventId,
  caseId: alert.caseId,
  eventType: "publication",
  occurredAt: alert.sourceOccurredAt,
  title: "Publicação localizada",
  description: "Trecho processual decodificado.",
  sources: [{
    sourceId: "djen",
    official: true,
    collectedAt: "2026-08-31T10:01:00.000Z",
  }],
} satisfies CaseTimelineEvent;

const portfolioCase = {
  caseId: alert.caseId,
  cnjNumber: alert.cnjNumber,
  tribunal: alert.tribunal,
  identityStatus: "confirmed",
  lastUpdatedAt: "2026-08-31T10:01:00.000Z",
  sources: [{
    sourceId: "djen",
    official: true,
    collectedAt: "2026-08-31T10:01:00.000Z",
  }],
} satisfies PersistedPortfolioCase;

const persistedDocument = {
  documentId: "88000000-0000-7000-8000-000000000801",
  caseId: alert.caseId,
  caseEventId: alert.caseEventId,
  title: "Intimação para manifestação",
  documentType: "intimacao",
  accessClass: "public_official",
  availabilityStatus: "available",
  expectedMediaType: "application/pdf",
  sourceCreatedAt: "2026-08-31T10:00:00.000Z",
  lastVerifiedAt: "2026-08-31T10:01:00.000Z",
  source: { sourceId: "djen", official: true },
  artifact: {
    artifactId: "89000000-0000-7000-8000-000000000801",
    mediaType: "application/pdf",
    sizeBytes: 2048,
    sha256: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-09-01T10:01:00.000Z",
  },
} satisfies PersistedCaseDocument;

const materializableDocument = {
  ...persistedDocument,
  documentId: "88000000-0000-7000-8000-000000000811",
  title: "Decisão pública ainda não preparada",
  availabilityStatus: "metadata_only",
  artifact: null,
} satisfies PersistedCaseDocument;

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ActivityCenter", () => {
  it("shows the same persisted alert facts in simple and advanced modes without refetching", async () => {
    const localSession = {
      ...session,
      getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") return Promise.resolve(response({
        cases: [portfolioCase], page: { nextCursor: null },
      }));
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [alert], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const view = render(
      <ActivityCenter session={localSession} fetcher={fetcher} viewMode="simple" />,
    );

    expect(await screen.findByRole("heading", { name: "Acompanhamento" })).toBeVisible();
    expect(screen.getAllByText(alert.cnjNumber)).toHaveLength(2);
    expect(screen.getByText("1 não lido")).toBeVisible();
    expect(screen.getByText(/correspondência ainda não verificada/i)).toBeVisible();
    expect(screen.queryByText(alert.caseId)).not.toBeInTheDocument();

    view.rerender(
      <ActivityCenter session={localSession} fetcher={fetcher} viewMode="advanced" />,
    );
    expect(screen.getAllByText(alert.caseId)).toHaveLength(2);
    expect(screen.getByText(alert.caseEventId)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(localSession.getIdToken).toHaveBeenCalledTimes(1);
  });

  it("uses the persisted portfolio as the primary surface and opens one shared timeline", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") return Promise.resolve(response({
        cases: [portfolioCase], page: { nextCursor: null },
      }));
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [alert], nextCursor: null }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/events?limit=20`) {
        return Promise.resolve(response({ events: [timelineEvent], page: { nextCursor: null } }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/documents?limit=20`) {
        return Promise.resolve(response({ documents: [], page: { nextCursor: null } }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    render(<ActivityCenter
      session={session}
      fetcher={fetcher}
      viewMode="simple"
      profileCount={1}
      profilesLoading={false}
    />);

    const portfolioHeading = await screen.findByRole("heading", { name: "Carteira de processos" });
    const activityHeading = screen.getByRole("heading", { name: "Acompanhamento" });
    expect(portfolioHeading.compareDocumentPosition(activityHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    await user.click(screen.getByRole("button", {
      name: `Abrir processo ${portfolioCase.cnjNumber}`,
    }));
    expect(await screen.findByText(timelineEvent.title)).toBeVisible();
    expect(screen.queryByText("Origem do alerta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", {
      name: `Ver linha do tempo de ${alert.cnjNumber}`,
    }));
    expect(await screen.findByText("Origem do alerta")).toBeVisible();
    expect(screen.getAllByRole("heading", {
      name: `Linha do tempo de ${alert.cnjNumber}`,
    })).toHaveLength(1);
  });

  it("opens the exact timeline, highlights its source event, paginates and marks only the alert read", async () => {
    const secondEvent = {
      ...timelineEvent,
      eventId: "86000000-0000-7000-8000-000000000802",
      occurredAt: "2026-08-30T10:00:00.000Z",
      title: "Evento anterior",
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = urlOf(input);
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [alert], nextCursor: null }));
      }
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [portfolioCase], page: { nextCursor: null } }));
      }
      if (url === `/api/v1/alerts/${alert.alertId}/read` && init?.method === "PATCH") {
        return Promise.resolve(response({ alert: {
          ...alert,
          status: "read",
          readAt: "2026-08-31T10:05:00.000Z",
        } }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/events?limit=20`) {
        return Promise.resolve(response({
          events: [timelineEvent],
          page: { nextCursor: "timeline_next" },
        }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/documents?limit=20`) {
        return Promise.resolve(response({
          documents: [persistedDocument], page: { nextCursor: null },
        }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/events?limit=20&cursor=timeline_next`) {
        return Promise.resolve(response({
          events: [secondEvent],
          page: { nextCursor: null },
        }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    const view = render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", {
      name: `Ver linha do tempo de ${alert.cnjNumber}`,
    }));
    const sourceEvent = await screen.findByRole("article", {
      name: "Publicação localizada",
    });
    expect(sourceEvent).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Trecho processual decodificado.")).toBeVisible();
    expect(screen.getAllByText("Fonte oficial")).toHaveLength(2);
    expect(screen.getByText(persistedDocument.title)).toBeVisible();
    expect(screen.getByText("Vinculado a uma publicação exata")).toBeVisible();
    expect(screen.getByRole("button", {
      name: `Baixar ${persistedDocument.title} em PDF`,
    })).toBeEnabled();
    expect(screen.getByText("Arquivo validado e pronto para download.")).toBeVisible();
    expect(screen.queryByText(persistedDocument.artifact.sha256)).not.toBeInTheDocument();

    const callsBeforeModeChange = fetcher.mock.calls.length;
    view.rerender(<ActivityCenter session={session} fetcher={fetcher} viewMode="advanced" />);
    expect(screen.getByText(persistedDocument.artifact.sha256)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(callsBeforeModeChange);

    await user.click(screen.getByRole("button", { name: "Carregar eventos anteriores" }));
    expect(await screen.findByText("Evento anterior")).toBeVisible();

    await user.click(screen.getByRole("button", {
      name: `Marcar alerta de ${alert.cnjNumber} como lido`,
    }));
    expect(await screen.findByText("Lido")).toBeVisible();
    expect(screen.queryByText("1 não lido")).not.toBeInTheDocument();
  });

  it("renews authorization and saves only the exact persisted PDF", async () => {
    const bytes = new Uint8Array(persistedDocument.artifact.sizeBytes);
    bytes.set(new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF"));
    const localSession = {
      ...session,
      getIdToken: vi.fn()
        .mockResolvedValueOnce("initial-token")
        .mockResolvedValueOnce("timeline-token")
        .mockResolvedValueOnce("download-token"),
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [portfolioCase], page: { nextCursor: null } }));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/events?limit=20`) {
        return Promise.resolve(response({ events: [], page: { nextCursor: null } }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/documents?limit=20`) {
        return Promise.resolve(response({
          documents: [persistedDocument], page: { nextCursor: null },
        }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/documents/${persistedDocument.documentId}/content`) {
        return Promise.resolve(new Response(bytes, { headers: {
          "content-type": "application/pdf",
          "content-length": String(bytes.byteLength),
          "content-disposition": "attachment; filename=documento.pdf",
          "x-document-sha256": persistedDocument.artifact.sha256,
        } }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:document-download");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<ActivityCenter session={localSession} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", {
      name: `Abrir processo ${portfolioCase.cnjNumber}`,
    }));
    await user.click(await screen.findByRole("button", {
      name: `Baixar ${persistedDocument.title} em PDF`,
    }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(localSession.getIdToken).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/cases/${alert.caseId}/documents/${persistedDocument.documentId}/content`,
      {
        headers: { authorization: "Bearer download-token" },
        cache: "no-store",
        redirect: "error",
      },
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:document-download");
  });

  it("requests preparation only for the exact public document and announces its state", async () => {
    const localSession = {
      ...session,
      getIdToken: vi.fn()
        .mockResolvedValueOnce("initial-token")
        .mockResolvedValueOnce("timeline-token")
        .mockResolvedValueOnce("materialization-token"),
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [portfolioCase], page: { nextCursor: null } }));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/events?limit=20`) {
        return Promise.resolve(response({ events: [], page: { nextCursor: null } }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/documents?limit=20`) {
        return Promise.resolve(response({
          documents: [materializableDocument], page: { nextCursor: null },
        }));
      }
      if (
        url === `/api/v1/cases/${alert.caseId}/documents/${materializableDocument.documentId}/materializations` &&
        init?.method === "POST"
      ) {
        return Promise.resolve(response({
          materializationId: "8c000000-0000-7000-8000-000000000811",
          documentId: materializableDocument.documentId,
          state: "queued",
        }, 202));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    render(<ActivityCenter
      session={localSession}
      fetcher={fetcher}
      viewMode="simple"
    />);

    await user.click(await screen.findByRole("button", {
      name: `Abrir processo ${portfolioCase.cnjNumber}`,
    }));
    const action = await screen.findByRole("button", {
      name: `Preparar ${materializableDocument.title} para download`,
    });
    expect(action).toHaveTextContent("Preparar arquivo");
    await user.click(action);

    expect(await screen.findByText(
      "Preparação solicitada. O arquivo passará por validação.",
    )).toBeVisible();
    expect(action).toBeDisabled();
    expect(action).toHaveTextContent("Preparação solicitada");
    expect(localSession.getIdToken).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/cases/${alert.caseId}/documents/${materializableDocument.documentId}/materializations`,
      {
        method: "POST",
        headers: { authorization: "Bearer materialization-token" },
        cache: "no-store",
        redirect: "error",
      },
    );
  });

  it("keeps a download failure attached only to its document", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [portfolioCase], page: { nextCursor: null } }));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/events?limit=20`) {
        return Promise.resolve(response({ events: [], page: { nextCursor: null } }));
      }
      if (url === `/api/v1/cases/${alert.caseId}/documents?limit=20`) {
        return Promise.resolve(response({
          documents: [persistedDocument], page: { nextCursor: null },
        }));
      }
      if (url.endsWith(`/${persistedDocument.documentId}/content`)) {
        return Promise.resolve(response({
          code: "DOCUMENT_DOWNLOAD_QUOTA_EXCEEDED",
          message: "Limite temporário de downloads atingido.",
        }, 429));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", {
      name: `Abrir processo ${portfolioCase.cnjNumber}`,
    }));
    await user.click(await screen.findByRole("button", {
      name: `Baixar ${persistedDocument.title} em PDF`,
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Limite temporário de downloads atingido.",
    );
    expect(screen.getByRole("button", {
      name: `Baixar ${persistedDocument.title} em PDF`,
    })).toBeEnabled();
  });

  it("ignores a late response from a previously selected process", async () => {
    const otherAlert = {
      ...alert,
      alertId: "90000000-0000-7000-8000-000000000802",
      caseId: "83000000-0000-7000-8000-000000000802",
      caseEventId: "86000000-0000-7000-8000-000000000802",
      cnjNumber: "0000002-23.2026.8.99.0802",
    };
    let resolveFirst: ((value: Response) => void) | undefined;
    let resolveSecond: ((value: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url.startsWith("/api/v1/alerts?")) {
        return Promise.resolve(response({ items: [alert, otherAlert], nextCursor: null }));
      }
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [], page: { nextCursor: null } }));
      }
      if (url.endsWith("/documents?limit=20")) {
        return Promise.resolve(response({ documents: [], page: { nextCursor: null } }));
      }
      if (url.includes(alert.caseId)) return first;
      if (url.includes(otherAlert.caseId)) return second;
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", {
      name: `Ver linha do tempo de ${alert.cnjNumber}`,
    }));
    await user.click(screen.getByRole("button", {
      name: `Ver linha do tempo de ${otherAlert.cnjNumber}`,
    }));

    resolveSecond?.(response({ events: [{
      ...timelineEvent,
      eventId: otherAlert.caseEventId,
      caseId: otherAlert.caseId,
      title: "Evento do segundo processo",
    }], page: { nextCursor: null } }));
    expect(await screen.findByText("Evento do segundo processo")).toBeVisible();

    resolveFirst?.(response({ events: [timelineEvent], page: { nextCursor: null } }));
    await waitFor(() => expect(screen.queryByText(timelineEvent.title)).not.toBeInTheDocument());
    expect(screen.getByRole("heading", {
      name: `Linha do tempo de ${otherAlert.cnjNumber}`,
    })).toBeVisible();
  });

  it("keeps activity failures local and supports an empty account", async () => {
    const failed = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [], page: { nextCursor: null } }));
      }
      return Promise.resolve(
        response({ code: "ALERTS_UNAVAILABLE", message: "Acompanhamento temporariamente indisponível." }, 503),
      );
    });
    const failedView = render(
      <ActivityCenter session={session} fetcher={failed} viewMode="simple" />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Acompanhamento temporariamente indisponível.",
    );

    failedView.unmount();
    render(
      <ActivityCenter
        session={session}
        fetcher={vi.fn<typeof fetch>().mockImplementation((input) =>
          Promise.resolve(urlOf(input).startsWith("/api/v1/cases?")
            ? response({ cases: [], page: { nextCursor: null } })
            : response({ items: [], nextCursor: null })),
        )}
        viewMode="simple"
        profileCount={0}
        profilesLoading={false}
      />,
    );
    expect(await screen.findByText("Sua carteira ainda não está monitorada.")).toBeVisible();
    expect(screen.getByText("Nenhuma novidade persistida ainda.")).toBeVisible();
  });

  it("distinguishes active monitoring without cases from a persisted case without events", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [], page: { nextCursor: null } }));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const view = render(<ActivityCenter
      session={session}
      fetcher={fetcher}
      viewMode="simple"
      profileCount={1}
      profilesLoading={false}
    />);
    expect(await screen.findByText("Monitoramento ativo, sem processos coletados.")).toBeVisible();

    view.unmount();
    const persistedWithoutEvents = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [portfolioCase], page: { nextCursor: null } }));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      if (url === `/api/v1/cases/${portfolioCase.caseId}/events?limit=20`) {
        return Promise.resolve(response({ events: [], page: { nextCursor: null } }));
      }
      if (url === `/api/v1/cases/${portfolioCase.caseId}/documents?limit=20`) {
        return Promise.resolve(response({ documents: [], page: { nextCursor: null } }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={persistedWithoutEvents} viewMode="simple" />);
    await user.click(await screen.findByRole("button", {
      name: `Abrir processo ${portfolioCase.cnjNumber}`,
    }));
    expect(await screen.findByText("Processo persistido, mas ainda sem eventos coletados.")).toBeVisible();
  });

  it("paginates older alerts without replacing the first page", async () => {
    const older = {
      ...alert,
      alertId: "90000000-0000-7000-8000-000000000802",
      caseId: "83000000-0000-7000-8000-000000000802",
      caseEventId: "86000000-0000-7000-8000-000000000802",
      cnjNumber: "0000002-23.2026.8.99.0802",
    };
    let alertPage = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [], page: { nextCursor: null } }));
      }
      if (url.startsWith("/api/v1/alerts?")) {
        alertPage += 1;
        return Promise.resolve(alertPage === 1
          ? response({ items: [alert], nextCursor: "alerts_next" })
          : response({ items: [older], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", {
      name: "Carregar alertas anteriores",
    }));
    expect(await screen.findByText(older.cnjNumber)).toBeVisible();
    expect(screen.getByText(alert.cnjNumber)).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/alerts?limit=20&status=all&cursor=alerts_next",
      { headers: { authorization: "Bearer firebase-id-token" } },
    );
  });

  it("fails a repeated alert across pages closed", async () => {
    let alertPage = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(response({ cases: [], page: { nextCursor: null } }));
      }
      alertPage += 1;
      return Promise.resolve(alertPage === 1
        ? response({ items: [alert], nextCursor: "alerts_next" })
        : response({ items: [alert], nextCursor: null }));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", {
      name: "Carregar alertas anteriores",
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O servidor repetiu dados de uma página anterior.",
    );
    expect(screen.getAllByText(alert.cnjNumber)).toHaveLength(1);
  });

  it("paginates the portfolio and fails repeated cases closed", async () => {
    let casePage = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url.startsWith("/api/v1/alerts?")) {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      casePage += 1;
      return Promise.resolve(casePage === 1
        ? response({ cases: [portfolioCase], page: { nextCursor: portfolioCase.caseId } })
        : response({ cases: [portfolioCase], page: { nextCursor: null } }));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", { name: "Carregar mais processos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O servidor repetiu dados de uma página anterior.",
    );
    expect(screen.getAllByText(portfolioCase.cnjNumber)).toHaveLength(1);
  });

  it("fails a stationary portfolio cursor closed", async () => {
    let casePage = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = urlOf(input);
      if (url.startsWith("/api/v1/alerts?")) {
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }
      casePage += 1;
      return Promise.resolve(casePage === 1
        ? response({ cases: [portfolioCase], page: { nextCursor: portfolioCase.caseId } })
        : response({ cases: [], page: { nextCursor: portfolioCase.caseId } }));
    });
    const user = userEvent.setup();
    render(<ActivityCenter session={session} fetcher={fetcher} viewMode="simple" />);

    await user.click(await screen.findByRole("button", { name: "Carregar mais processos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A paginação da carteira não avançou.",
    );
  });
});
