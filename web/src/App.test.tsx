import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { App } from "./App";
import type { AuthClient, AuthUser } from "./auth-client";
import type { DocumentSessionCallbacks } from "./document-session-client";

const responseBody = {
  target: {
    id: "name_abc",
    type: "name",
    displayValue: "Pessoa Exemplo",
  },
  source: {
    id: "DJEN",
    official: true,
    strategy: "nomeParte",
    confidence: "medium",
  },
  summary: {
    publications: 2,
    processes: 1,
    ungroupedPublications: 0,
    truncated: false,
  },
  processes: [
    {
      cnjNumber: "0000001-23.2026.8.99.0001",
      tribunal: "TJEX",
      organ: "Vara de Exemplo",
      className: "Classe de Exemplo",
      publicationCount: 2,
      lastPublicationAt: "2026-08-22",
      publications: [
        {
          id: "42",
          availableAt: "2026-08-22",
          summary: "Decisão de exemplo",
          communicationType: "Intimação",
          medium: "Diário de Justiça Eletrônico Nacional",
          documentType: "Despacho",
          communicationNumber: 98765,
          documentAvailable: true,
        },
      ],
    },
  ],
  warnings: ["Resultados por nome podem incluir homônimos."],
};

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();

const authenticatedUser: AuthUser = {
  email: "pessoa@example.test",
  emailVerified: true,
  getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
  sendVerification: vi.fn(),
};

const authClient = (): AuthClient => ({
  signIn: vi.fn().mockResolvedValue(authenticatedUser),
  signUp: vi.fn().mockResolvedValue(authenticatedUser),
  signOut: vi.fn().mockResolvedValue(undefined),
});

const sessionResponse = () =>
  new Response(
    JSON.stringify({ user: { userId: "user_alpha", memberships: [] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const monitoringSubject = {
  subjectId: "20000000-0000-8000-8000-000000000001",
  subjectType: "name",
  displayLabel: "P. E.",
  status: "active",
  version: 1,
  archivedAt: null,
  processCount: 2,
  processSummary: [
    {
      cnjNumber: "0000001-23.2026.8.99.0001",
      tribunal: "TJEX",
      lastActivityAt: "2026-08-30T12:00:00.000Z",
    },
    {
      cnjNumber: "0000002-23.2026.8.99.0001",
      tribunal: "TJEX",
      lastActivityAt: "2026-08-29T12:00:00.000Z",
    },
  ],
};

const monitoringResponse = (url: string): Response | undefined => {
  if (url === "/api/v1/cases?limit=20") {
    return new Response(JSON.stringify({ cases: [], page: { nextCursor: null } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "/api/v1/alerts?limit=20&status=all") {
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "/api/v1/monitoring/subjects?limit=100") {
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "/api/v1/monitoring/subjects") {
    return new Response(JSON.stringify({ subject: monitoringSubject }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }
  return undefined;
};

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const createAppFetcher = (
  searchBody: unknown = responseBody,
  searchStatus = 200,
) =>
  vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = requestUrl(input);
    if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
    const monitoring = monitoringResponse(url);
    if (monitoring) return Promise.resolve(monitoring);
    if (url === "/api/v1/searches") {
      return Promise.resolve(
        new Response(JSON.stringify(searchBody), {
          status: searchStatus,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });

const signIn = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Entrar" }));
  await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test");
  await user.type(screen.getByLabelText("Senha"), "uma-senha-segura");
  await user.click(screen.getByRole("button", { name: "Acessar minha conta" }));
  expect(await screen.findByText("pessoa@example.test")).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Cadastrar e buscar" }),
    ).toBeEnabled(),
  );
};

describe("App", () => {
  beforeEach(() => storage.clear());
  afterEach(cleanup);

  it("registers a protected profile and renders grouped official results", async () => {
    const user = userEvent.setup();
    const fetcher = createAppFetcher();
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);

    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/monitoring/subjects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/searches",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer firebase-id-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "name", value: "Pessoa Exemplo" }),
      }),
    );
    expect(await screen.findByText("0000001-23.2026.8.99.0001")).toBeVisible();
    expect(screen.getByText("Decisão de exemplo")).toBeVisible();
    expect(screen.getByText("Intimação")).toBeVisible();
    expect(screen.getByText("Diário de Justiça Eletrônico Nacional")).toBeVisible();
    expect(screen.getByText("Despacho")).toBeVisible();
    expect(screen.getByText("Comunicação 98765")).toBeVisible();
    expect(screen.getByText(/homônimos/i)).toBeVisible();
    expect(screen.getByText("P. E.")).toBeVisible();
    expect(screen.getByText("1 processo encontrado")).toBeVisible();
    expect(screen.getAllByText("0000001-23.2026.8.99.0001 · TJEX")).toHaveLength(2);
    expect(screen.getAllByText("Pessoa Exemplo")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Consultas desta sessão" }),
    ).toBeVisible();
    expect(storage.length).toBe(0);
  });

  it("lists free name-search results before presenting the commercial panel", async () => {
    const user = userEvent.setup();
    render(
      <App
        fetcher={createAppFetcher()}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));

    const resultSection = (
      await screen.findByRole("heading", { name: "Pessoa Exemplo", level: 2 })
    ).closest("section");
    const commercialSection = screen
      .getByRole("heading", {
        name: "Comece no essencial. Evolua quando fizer sentido.",
        level: 2,
      })
      .closest("section");

    expect(resultSection).not.toBeNull();
    expect(commercialSection).not.toBeNull();
    expect(
      resultSection!.compareDocumentPosition(commercialSection!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("button", { name: "Abrir processo" })).toBeVisible();
  });

  it("keeps one-off official search available while profile persistence is disabled", async () => {
    const user = userEvent.setup();
    const unavailable = () => new Response(
      JSON.stringify({
        code: "MONITORING_PROFILES_UNAVAILABLE",
        message: "O cadastro de perfis ainda não está configurado.",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(new Response(
          JSON.stringify({ cases: [], page: { nextCursor: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(new Response(
          JSON.stringify({ items: [], nextCursor: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (
        url === "/api/v1/monitoring/subjects?limit=100" ||
        url === "/api/v1/monitoring/subjects"
      ) return Promise.resolve(unavailable());
      if (url === "/api/v1/searches") {
        return Promise.resolve(new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));

    expect(await screen.findByText("Decisão de exemplo")).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/searches",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.getByRole("heading", { name: "Consultas desta sessão" })).toBeVisible();
  });

  it("keeps the experimental document-search limitation visible", async () => {
    const user = userEvent.setup();
    render(
      <App
        fetcher={vi.fn<typeof fetch>()}
        storage={storage}
      />,
    );

    await user.click(screen.getByLabelText("CPF"));

    expect(screen.getByText(/busca experimental/i)).toBeVisible();
    expect(screen.getByLabelText("CPF")).toBeChecked();
  });

  it("loads account profiles and archives them without browser persistence", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(new Response(
          JSON.stringify({ cases: [], page: { nextCursor: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url === "/api/v1/monitoring/subjects?limit=100") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [monitoringSubject], nextCursor: null }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (
        url ===
          `/api/v1/monitoring/subjects/${monitoringSubject.subjectId}` &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              subject: {
                ...monitoringSubject,
                status: "inactive",
                version: 2,
                archivedAt: "2026-08-30T12:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    storage.setItem(
      "meu-processo.targets.v1",
      JSON.stringify([{ value: "Pessoa Exemplo" }]),
    );
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);
    expect(await screen.findByText("P. E.")).toBeVisible();
    expect(storage.getItem("meu-processo.targets.v1")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Arquivar perfil P. E." }),
    );

    await waitFor(() => expect(screen.queryByText("P. E.")).not.toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/monitoring/subjects/${monitoringSubject.subjectId}`,
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer firebase-id-token",
          "if-match": '"1"',
        },
      },
    );
    expect(storage.length).toBe(0);
  });

  it("shows a safe API error and does not save a failed target", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(new Response(
          JSON.stringify({ cases: [], page: { nextCursor: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url === "/api/v1/monitoring/subjects?limit=100") {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url === "/api/v1/monitoring/subjects") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: "INVALID_MONITORING_PROFILE",
              message: "Informe um nome completo.",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);

    await user.type(screen.getByLabelText("Nome completo"), "Ana");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));

    expect(await screen.findByText("Informe um nome completo.")).toBeVisible();
    expect(
      fetcher.mock.calls.some(([input]) => requestUrl(input) === "/api/v1/searches"),
    ).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("shows identical case facts in simple and advanced modes without refetching", async () => {
    const user = userEvent.setup();
    const fetcher = createAppFetcher();
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);

    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));
    expect(await screen.findByText("0000001-23.2026.8.99.0001")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Modo avançado" }));

    expect(screen.getByRole("heading", { name: "Resultado técnico da consulta atual" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "0000001-23.2026.8.99.0001" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "TJEX" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "2" })).toBeVisible();
    expect(
      fetcher.mock.calls.filter(
        ([input]) => requestUrl(input) === "/api/v1/searches",
      ),
    ).toHaveLength(1);
  });

  it("does not consult the source before the user signs in", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>();
    render(<App fetcher={fetcher} storage={storage} />);

    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Entre na sua conta",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mounts persisted activity after login and removes it immediately on logout", async () => {
    const user = userEvent.setup();
    const persistedAlert = {
      alertId: "90000000-0000-7000-8000-000000000801",
      subjectId: "20000000-0000-7000-8000-000000000801",
      subjectLabel: "P. E.",
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
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      if (url === "/api/v1/cases?limit=20") {
        return Promise.resolve(new Response(
          JSON.stringify({ cases: [{
            caseId: persistedAlert.caseId,
            cnjNumber: persistedAlert.cnjNumber,
            tribunal: persistedAlert.tribunal,
            identityStatus: "confirmed",
            lastUpdatedAt: persistedAlert.createdAt,
            sources: [{
              sourceId: "djen",
              official: true,
              collectedAt: persistedAlert.createdAt,
            }],
          }], page: { nextCursor: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url === "/api/v1/monitoring/subjects?limit=100") {
        return Promise.resolve(new Response(
          JSON.stringify({ items: [], nextCursor: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url === "/api/v1/alerts?limit=20&status=all") {
        return Promise.resolve(new Response(
          JSON.stringify({ items: [persistedAlert], nextCursor: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
      />,
    );

    await signIn(user);
    expect(await screen.findByRole("heading", { name: "Acompanhamento" })).toBeVisible();
    expect(screen.getAllByText(persistedAlert.cnjNumber)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Modo avançado" }));
    expect(screen.getByText(persistedAlert.caseEventId)).toBeVisible();
    expect(fetcher.mock.calls.filter(
      ([input]) => requestUrl(input) === "/api/v1/alerts?limit=20&status=all",
    )).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(
      screen.queryByRole("heading", { name: "Acompanhamento" }),
    ).not.toBeInTheDocument());
    expect(screen.queryByText(persistedAlert.cnjNumber)).not.toBeInTheDocument();
    expect(storage.length).toBe(0);
  });

  it("downloads the authenticated DJEN copy without opening a tribunal challenge", async () => {
    const user = userEvent.setup();
    const saveFile = vi.fn();
    const copyBytes = new TextEncoder().encode("%PDF-copy");
    const copyHash = createHash("sha256").update(copyBytes).digest("hex");
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      const monitoring = monitoringResponse(url);
      if (monitoring) return Promise.resolve(monitoring);
      if (url === "/api/v1/searches") {
        return Promise.resolve(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (
        url ===
        "/api/v1/processes/00000012320268990001/communications/98765/publication-copy"
      ) {
        return Promise.resolve(
          new Response(copyBytes, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": String(copyBytes.byteLength),
              "content-disposition": "attachment; filename=untrusted.pdf",
              "x-document-sha256": copyHash,
            },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const openSession = vi.fn();
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
        saveFile={saveFile}
        openSession={openSession}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));
    await user.click(await screen.findByRole("button", { name: "Abrir processo" }));
    await user.click(
      screen.getByRole("button", { name: "Baixar cópia da publicação" }),
    );

    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith(
        expect.any(Blob),
        "0000001-23.2026.8.99.0001-comunicacao-98765-publicacao-djen.pdf",
      ),
    );
    expect(openSession).not.toHaveBeenCalled();
    expect(screen.getByText("Cópia DJEN baixada.")).toBeVisible();
  });

  it("opens a process and downloads its original publication through the authenticated proxy", async () => {
    const user = userEvent.setup();
    const saveFile = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      const monitoring = monitoringResponse(url);
      if (monitoring) return Promise.resolve(monitoring);
      if (url === "/api/v1/searches") {
        return Promise.resolve(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const openSession = vi.fn((input: { callbacks: DocumentSessionCallbacks }) => {
      queueMicrotask(() =>
        input.callbacks.onDocument({
          blob: new Blob(["%PDF-browser-test"], { type: "application/pdf" }),
          fileName: "processo-comunicacao-98765.pdf",
          sha256: "a".repeat(64),
        }),
      );
      return { answer: vi.fn(), close: vi.fn() };
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
        saveFile={saveFile}
        openSession={openSession}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));
    await user.click(
      await screen.findByRole("button", { name: "Abrir processo" }),
    );
    expect(screen.getByRole("heading", { name: /detalhe do processo/i })).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Tentar documento original (experimental)" }),
    );

    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/v1/processes/00000012320268990001/communications/98765/document/session",
        token: "firebase-id-token",
        callbacks: expect.any(Object),
      }),
    );
    expect(saveFile).toHaveBeenCalledWith(
      expect.any(Blob),
      "processo-comunicacao-98765.pdf",
    );
  });

  it("announces the publication session phase instead of leaving an indefinite action", async () => {
    const user = userEvent.setup();
    const fetcher = createAppFetcher();
    const openSession = vi.fn((input: { callbacks: DocumentSessionCallbacks }) => {
      queueMicrotask(() => input.callbacks.onStatus("preparing"));
      return { answer: vi.fn(), close: vi.fn() };
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
        openSession={openSession}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));
    await user.click(await screen.findByRole("button", { name: "Abrir processo" }));
    await user.click(
      screen.getByRole("button", { name: "Tentar documento original (experimental)" }),
    );

    expect(
      await screen.findByText("Aguardando resposta do tribunal…"),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("lets the authenticated user complete the tribunal visual challenge", async () => {
    const user = userEvent.setup();
    const saveFile = vi.fn();
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      const monitoring = monitoringResponse(url);
      if (monitoring) return Promise.resolve(monitoring);
      if (url === "/api/v1/searches") {
        return Promise.resolve(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    let sessionCallbacks: DocumentSessionCallbacks | undefined;
    const answer = vi.fn(() => {
      sessionCallbacks?.onDocument({
        blob: new Blob(["%PDF-challenge-test"], { type: "application/pdf" }),
        fileName: "processo-comunicacao-98765.pdf",
        sha256: "b".repeat(64),
      });
    });
    const openSession = vi.fn((input: { callbacks: DocumentSessionCallbacks }) => {
      sessionCallbacks = input.callbacks;
      queueMicrotask(() =>
        input.callbacks.onChallenge({
          imageDataUrl,
          expiresAt: "2026-08-30T12:02:00.000Z",
        }),
      );
      return { answer, close: vi.fn() };
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
        saveFile={saveFile}
        openSession={openSession}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));
    await user.click(
      await screen.findByRole("button", { name: "Abrir processo" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Tentar documento original (experimental)" }),
    );

    expect(
      await screen.findByRole("img", {
        name: "Código de segurança exibido pelo tribunal",
      }),
    ).toHaveAttribute("src", imageDataUrl);
    await user.type(screen.getByLabelText("Código de segurança"), "A19b");
    await user.click(screen.getByRole("button", { name: "Validar e baixar" }));

    expect(answer).toHaveBeenCalledWith("A19b");
    expect(saveFile).toHaveBeenCalledWith(
      expect.any(Blob),
      "processo-comunicacao-98765.pdf",
    );
    expect(screen.queryByLabelText("Código de segurança")).not.toBeInTheDocument();
  });

  it("shows a safe message when the renderer rejects the source policy", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
      const monitoring = monitoringResponse(url);
      if (monitoring) return Promise.resolve(monitoring);
      if (url === "/api/v1/searches") {
        return Promise.resolve(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const openSession = vi.fn((input: { callbacks: DocumentSessionCallbacks }) => {
      queueMicrotask(() => input.callbacks.onError("SOURCE_POLICY_REJECTED"));
      return { answer: vi.fn(), close: vi.fn() };
    });
    render(
      <App
        fetcher={fetcher}
        storage={storage}
        loadAuthClient={vi.fn().mockResolvedValue(authClient())}
        openSession={openSession}
      />,
    );

    await signIn(user);
    await user.type(screen.getByLabelText("Nome completo"), "Pessoa Exemplo");
    await user.click(screen.getByRole("button", { name: "Cadastrar e buscar" }));
    await user.click(
      await screen.findByRole("button", { name: "Abrir processo" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Tentar documento original (experimental)" }),
    );

    expect(await screen.findByText(
      "A origem não passou pela política de segurança.",
    )).toBeVisible();
    expect(
      screen.queryByRole("img", {
        name: "Código de segurança exibido pelo tribunal",
      }),
    ).not.toBeInTheDocument();
  });
});
