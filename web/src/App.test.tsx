import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const signIn = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Entrar" }));
  await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test");
  await user.type(screen.getByLabelText("Senha"), "uma-senha-segura");
  await user.click(screen.getByRole("button", { name: "Acessar minha conta" }));
  expect(await screen.findByText("pessoa@example.test")).toBeVisible();
};

describe("App", () => {
  beforeEach(() => storage.clear());
  afterEach(cleanup);

  it("registers a name locally and renders grouped official results", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input) === "/api/v1/session"
          ? sessionResponse()
          : new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      ),
    );
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
    expect(screen.getAllByText("Pessoa Exemplo")).toHaveLength(2);
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

  it("shows a safe API error and does not save a failed target", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input) === "/api/v1/session"
          ? sessionResponse()
          : new Response(
              JSON.stringify({
                code: "INVALID_TARGET",
                message: "Informe um nome completo.",
              }),
              { status: 400, headers: { "content-type": "application/json" } },
            ),
      ),
    );
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe um nome completo.",
    );
    expect(storage.length).toBe(0);
  });

  it("shows identical case facts in simple and advanced modes without refetching", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input) === "/api/v1/session"
          ? sessionResponse()
          : new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      ),
    );
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

    expect(screen.getByRole("heading", { name: "Carteira avançada" })).toBeVisible();
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

  it("opens a process and downloads its publication through the authenticated proxy", async () => {
    const user = userEvent.setup();
    const saveFile = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
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
      screen.getByRole("button", { name: "Baixar publicação pelo proxy" }),
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

  it("lets the authenticated user complete the tribunal visual challenge", async () => {
    const user = userEvent.setup();
    const saveFile = vi.fn();
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url === "/api/v1/session") return Promise.resolve(sessionResponse());
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
      screen.getByRole("button", { name: "Baixar publicação pelo proxy" }),
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
      screen.getByRole("button", { name: "Baixar publicação pelo proxy" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A origem não passou pela política de segurança.",
    );
    expect(
      screen.queryByRole("img", {
        name: "Código de segurança exibido pelo tribunal",
      }),
    ).not.toBeInTheDocument();
  });
});
