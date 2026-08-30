import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { TokenVerifier } from "./authentication.js";
import {
  AssistedDocumentSession,
  type AssistedRendererConnector,
  type AssistedRendererObserver,
  type AssistedRendererSession,
  type DocumentSessionPeer,
} from "./assisted-document-session.js";
import type { DjenPublicationLocator } from "./publication-proxy.js";
import type { RequestRateLimiter } from "./request-rate-limiter.js";

const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF");
const PDF_SHA256 = createHash("sha256").update(PDF).digest("hex");
const SOURCE_URL =
  "https://eproc1g.tjrs.jus.br/eproc/controlador.php?acao=acessar_documento_publico";
const CHALLENGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

class Peer implements DocumentSessionPeer {
  readonly text: unknown[] = [];
  readonly binary: Uint8Array[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  sendJson(value: unknown) {
    this.text.push(value);
  }

  sendBinary(value: Uint8Array) {
    this.binary.push(value);
  }

  close(code: number, reason: string) {
    this.closes.push({ code, reason });
  }
}

class Renderer implements AssistedRendererSession {
  readonly answers: string[] = [];
  close = vi.fn();

  sendAnswer(answer: string) {
    this.answers.push(answer);
  }
}

class Connector implements AssistedRendererConnector {
  readonly renderer = new Renderer();
  observer?: AssistedRendererObserver;
  connect = vi.fn(
    (
      _input: {
        sourceUrl: string;
        cnjNumber: string;
        communicationNumber: number;
      },
      observer: AssistedRendererObserver,
    ) => {
      this.observer = observer;
      return Promise.resolve(this.renderer);
    },
  );
}

const dependencies = ({
  verify = vi.fn(() => Promise.resolve({ userId: "user-a", memberships: [] })),
  find = vi.fn(() => Promise.resolve({
    numeroProcesso: "5015790-60.2026.8.21.0003",
    numeroComunicacao: 37884,
    link: SOURCE_URL,
    tipoDocumento: "Intimação",
  })),
  allow = vi.fn(() => true),
  connector = new Connector(),
}: {
  verify?: TokenVerifier["verify"];
  find?: DjenPublicationLocator["findCommunication"];
  allow?: RequestRateLimiter["allow"];
  connector?: Connector;
} = {}) => ({
  tokenVerifier: { verify } satisfies TokenVerifier,
  publicationLocator: { findCommunication: find } satisfies DjenPublicationLocator,
  requestRateLimiter: { allow } satisfies RequestRateLimiter,
  rendererConnector: connector,
  connector,
});

const createSession = (
  deps = dependencies(),
  peer = new Peer(),
  schedule: (callback: () => void, delayMs: number) => () => void = vi.fn(
    () => vi.fn(),
  ),
) => ({
  session: new AssistedDocumentSession(
    {
      cnjNumber: "50157906020268210003",
      communicationNumber: "37884",
    },
    peer,
    deps,
    { schedule },
  ),
  peer,
  deps,
  schedule,
});

const authenticate = (session: AssistedDocumentSession) =>
  session.receiveText(JSON.stringify({ type: "authenticate", token: "token-a" }));

describe("AssistedDocumentSession", () => {
  it("authenticates before resolving the publication or opening the renderer", async () => {
    const { session, peer, deps, schedule } = createSession();

    await authenticate(session);

    expect(deps.tokenVerifier.verify).toHaveBeenCalledWith("token-a");
    expect(deps.publicationLocator.findCommunication).toHaveBeenCalledWith({
      cnjNumber: "50157906020268210003",
      communicationNumber: 37884,
    });
    expect(deps.requestRateLimiter.allow).toHaveBeenCalledWith(
      "document-session:user-a",
      20,
      60_000,
    );
    expect(deps.connector.connect).toHaveBeenCalledWith(
      {
        sourceUrl: SOURCE_URL,
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      },
      expect.any(Object),
    );
    expect(peer.text).toEqual([{ type: "status", status: "preparing" }]);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 120_000);
  });

  it.each([
    ["not-json"],
    ["null"],
    ["1"],
    [JSON.stringify({ type: "answer", answer: "123" })],
    [JSON.stringify({ type: "authenticate", token: "" })],
    [JSON.stringify({ type: "authenticate", token: "x".repeat(8_193) })],
  ])("rejects an invalid first frame without touching sources", async (frame) => {
    const { session, peer, deps } = createSession();

    await session.receiveText(frame);

    expect(peer.text).toEqual([
      {
        type: "error",
        code: "INVALID_SESSION_MESSAGE",
        message: "A sessão recebeu uma mensagem inválida.",
      },
    ]);
    expect(peer.closes).toEqual([{ code: 1008, reason: "invalid_message" }]);
    expect(deps.publicationLocator.findCommunication).not.toHaveBeenCalled();
    expect(deps.connector.connect).not.toHaveBeenCalled();
  });

  it("fails closed when the token is rejected", async () => {
    const deps = dependencies({
      verify: vi.fn(() =>
        Promise.reject(new Error("revoked token details must not escape")),
      ),
    });
    const { session, peer } = createSession(deps);

    await authenticate(session);

    expect(peer.text).toEqual([
      {
        type: "error",
        code: "UNAUTHENTICATED",
        message: "Autenticação necessária.",
      },
    ]);
    expect(peer.closes).toEqual([{ code: 1008, reason: "unauthenticated" }]);
    expect(deps.publicationLocator.findCommunication).not.toHaveBeenCalled();
  });

  it("applies a per-user rate limit before the DJEN request", async () => {
    const deps = dependencies({ allow: vi.fn(() => false) });
    const { session, peer } = createSession(deps);

    await authenticate(session);

    expect(peer.text).toEqual([
      {
        type: "error",
        code: "RATE_LIMITED",
        message: "Limite temporário atingido. Aguarde um minuto.",
      },
    ]);
    expect(peer.closes).toEqual([{ code: 1008, reason: "rate_limited" }]);
    expect(deps.publicationLocator.findCommunication).not.toHaveBeenCalled();
  });

  it("does not open a renderer when the exact DJEN publication is absent", async () => {
    const deps = dependencies({ find: vi.fn(() => Promise.resolve(undefined)) });
    const { session, peer } = createSession(deps);

    await authenticate(session);

    expect(peer.text).toEqual([
      {
        type: "error",
        code: "PUBLICATION_NOT_FOUND",
        message: "Publicação não encontrada.",
      },
    ]);
    expect(peer.closes).toEqual([
      { code: 1008, reason: "publication_not_found" },
    ]);
    expect(deps.connector.connect).not.toHaveBeenCalled();
  });

  it("rejects an answer before the renderer presents a challenge", async () => {
    const { session, peer } = createSession();
    await authenticate(session);

    await session.receiveText(JSON.stringify({ type: "answer", answer: "A19b" }));

    expect(peer.text.at(-1)).toMatchObject({ code: "INVALID_SESSION_MESSAGE" });
  });

  it("stops safely when closed during token, DJEN or renderer resolution", async () => {
    let resolveVerify!: TokenVerifier["verify"] extends (
      token: string,
    ) => Promise<infer Result>
      ? (value: Result) => void
      : never;
    const verifyPromise = new Promise<Awaited<ReturnType<TokenVerifier["verify"]>>>(
      (resolve) => {
        resolveVerify = resolve;
      },
    );
    const verifying = createSession(
      dependencies({ verify: vi.fn(() => verifyPromise) }),
    );
    const authentication = authenticate(verifying.session);
    verifying.session.close();
    resolveVerify({ userId: "user-a", memberships: [] });
    await authentication;
    expect(verifying.deps.publicationLocator.findCommunication).not.toHaveBeenCalled();

    let resolveFind!: (value: Awaited<ReturnType<DjenPublicationLocator["findCommunication"]>>) => void;
    const findPromise = new Promise<
      Awaited<ReturnType<DjenPublicationLocator["findCommunication"]>>
    >((resolve) => {
      resolveFind = resolve;
    });
    const resolving = createSession(
      dependencies({ find: vi.fn(() => findPromise) }),
    );
    const resolution = authenticate(resolving.session);
    await vi.waitFor(() =>
      expect(resolving.deps.publicationLocator.findCommunication).toHaveBeenCalledOnce(),
    );
    resolving.session.close();
    resolveFind({
      numeroProcesso: "5015790-60.2026.8.21.0003",
      numeroComunicacao: 37884,
      link: SOURCE_URL,
      tipoDocumento: "Intimação",
    });
    await resolution;
    expect(resolving.deps.connector.connect).not.toHaveBeenCalled();

    let rejectFind!: (reason: Error) => void;
    const rejectedFind = new Promise<never>((_resolve, reject) => {
      rejectFind = reject;
    });
    const rejecting = createSession(
      dependencies({ find: vi.fn(() => rejectedFind) }),
    );
    const rejectedResolution = authenticate(rejecting.session);
    await vi.waitFor(() =>
      expect(rejecting.deps.publicationLocator.findCommunication).toHaveBeenCalledOnce(),
    );
    rejecting.session.close();
    rejectFind(new Error("late details"));
    await rejectedResolution;

    let resolveRenderer!: (value: Renderer) => void;
    const rendererPromise = new Promise<Renderer>((resolve) => {
      resolveRenderer = resolve;
    });
    const connector = new Connector();
    connector.connect.mockImplementationOnce((_input, observer) => {
      connector.observer = observer;
      return rendererPromise;
    });
    const connecting = createSession(dependencies({ connector }));
    const connection = authenticate(connecting.session);
    await vi.waitFor(() => expect(connector.connect).toHaveBeenCalledOnce());
    connecting.session.close();
    resolveRenderer(connector.renderer);
    await connection;
    expect(connector.renderer.close).toHaveBeenCalledOnce();
  });

  it("preserves a synchronous renderer challenge state during connection", async () => {
    const connector = new Connector();
    connector.connect.mockImplementationOnce((_input, observer) => {
      connector.observer = observer;
      observer.onChallenge({
        imageDataUrl: CHALLENGE,
        expiresAt: "2026-08-30T12:02:00.000Z",
      });
      return Promise.resolve(connector.renderer);
    });
    const context = createSession(dependencies({ connector }));
    await authenticate(context.session);
    await context.session.receiveText(
      JSON.stringify({ type: "answer", answer: "A19b" }),
    );
    expect(connector.renderer.answers).toEqual(["A19b"]);
  });

  it("maps an unexpected DJEN or renderer connection failure categorically", async () => {
    const djenFailure = createSession(
      dependencies({
        find: vi.fn(() => Promise.reject(new Error("upstream details"))),
      }),
    );
    await authenticate(djenFailure.session);
    expect(djenFailure.peer.text.at(-1)).toMatchObject({
      code: "SOURCE_UNAVAILABLE",
    });

    const connector = new Connector();
    connector.connect.mockRejectedValueOnce(new Error("renderer details"));
    const rendererFailure = createSession(dependencies({ connector }));
    await authenticate(rendererFailure.session);
    expect(rendererFailure.peer.text.at(-1)).toMatchObject({
      code: "SOURCE_UNAVAILABLE",
    });
  });

  it("forwards a bounded challenge and only a valid human answer", async () => {
    const { session, peer, deps } = createSession();
    await authenticate(session);

    deps.connector.observer?.onChallenge({
      imageDataUrl: CHALLENGE,
      expiresAt: "2026-08-30T12:02:00.000Z",
    });
    await session.receiveText(
      JSON.stringify({ type: "answer", answer: "A1B2C3" }),
    );

    expect(peer.text).toEqual([
      { type: "status", status: "preparing" },
      {
        type: "challenge",
        imageDataUrl: CHALLENGE,
        expiresAt: "2026-08-30T12:02:00.000Z",
      },
    ]);
    expect(deps.connector.renderer.answers).toEqual(["A1B2C3"]);
  });

  it.each([
    ["data:image/svg+xml;base64,PHN2Zz4=", "2026-08-30T12:02:00.000Z"],
    [CHALLENGE, "not-a-date"],
    [`data:image/png;base64,${"A".repeat(1_000_001)}`, "2026-08-30T12:02:00.000Z"],
  ])("rejects an invalid visual challenge", async (imageDataUrl, expiresAt) => {
    const { session, peer, deps } = createSession();
    await authenticate(session);
    deps.connector.observer?.onChallenge({ imageDataUrl, expiresAt });
    expect(peer.text.at(-1)).toMatchObject({ code: "SOURCE_POLICY_REJECTED" });
  });

  it("marks a replacement challenge without creating another session", async () => {
    const { session, peer, deps } = createSession();
    await authenticate(session);
    deps.connector.observer?.onChallenge({
      imageDataUrl: CHALLENGE,
      expiresAt: "2026-08-30T12:02:00.000Z",
      rejected: true,
    });
    expect(peer.text.at(-1)).toMatchObject({ rejected: true });
  });

  it.each(["", "with space", "áé", "x".repeat(33)])(
    "rejects invalid challenge answer %j and closes the renderer",
    async (answer) => {
      const { session, peer, deps } = createSession();
      await authenticate(session);
      deps.connector.observer?.onChallenge({
        imageDataUrl: CHALLENGE,
        expiresAt: "2026-08-30T12:02:00.000Z",
      });

      await session.receiveText(JSON.stringify({ type: "answer", answer }));

      expect(peer.text.at(-1)).toEqual({
        type: "error",
        code: "INVALID_CHALLENGE_ANSWER",
        message: "Use apenas letras e números no código de segurança.",
      });
      expect(peer.closes).toEqual([
        { code: 1008, reason: "invalid_challenge_answer" },
      ]);
      expect(deps.connector.renderer.close).toHaveBeenCalledOnce();
    },
  );

  it("validates metadata, hash and PDF bytes before sending one document", async () => {
    const { session, peer, deps } = createSession();
    await authenticate(session);

    deps.connector.observer?.onDocument({
      bytes: PDF,
      mediaType: "application/pdf",
      sha256: PDF_SHA256,
    });

    expect(peer.text).toEqual([
      { type: "status", status: "preparing" },
      {
        type: "document",
        fileName:
          "5015790-60.2026.8.21.0003-comunicacao-37884.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: PDF_SHA256,
      },
    ]);
    expect(peer.binary).toEqual([PDF]);
    expect(peer.closes).toEqual([{ code: 1000, reason: "complete" }]);
    expect(deps.connector.renderer.close).toHaveBeenCalledOnce();
  });

  it.each([
    [new Uint8Array(), PDF_SHA256],
    [new TextEncoder().encode("not-pdf"), PDF_SHA256],
    [PDF, "0".repeat(64)],
    [new Uint8Array(25 * 1024 * 1024 + 1), "0".repeat(64)],
  ])("rejects an invalid renderer document", async (bytes, sha256) => {
    const { session, peer, deps } = createSession();
    await authenticate(session);

    deps.connector.observer?.onDocument({
      bytes,
      mediaType: "application/pdf",
      sha256,
    });

    expect(peer.binary).toEqual([]);
    expect(peer.text.at(-1)).toEqual({
      type: "error",
      code: "DOCUMENT_INTEGRITY_REJECTED",
      message: "O documento recebido não passou pela validação de integridade.",
    });
    expect(peer.closes).toEqual([
      { code: 1011, reason: "document_integrity_rejected" },
    ]);
  });

  it("maps renderer failures without reflecting upstream details", async () => {
    const { session, peer, deps } = createSession();
    await authenticate(session);

    deps.connector.observer?.onError("SOURCE_POLICY_REJECTED");

    expect(peer.text.at(-1)).toEqual({
      type: "error",
      code: "SOURCE_POLICY_REJECTED",
      message: "A página oficial foi bloqueada pela política de segurança.",
    });
    expect(peer.closes).toEqual([
      { code: 1011, reason: "source_policy_rejected" },
    ]);
  });

  it("uses a normal close code for a renderer-side expiration", async () => {
    const { session, peer, deps } = createSession();
    await authenticate(session);
    deps.connector.observer?.onError("SESSION_EXPIRED");
    expect(peer.closes).toEqual([{ code: 1000, reason: "session_expired" }]);
  });

  it("closes every resource once on timeout, cancellation and late events", async () => {
    let expire: () => void = () => undefined;
    const schedule = vi.fn((callback: () => void) => {
      expire = callback;
      return vi.fn();
    });
    const { session, peer, deps } = createSession(
      dependencies(),
      new Peer(),
      schedule,
    );
    await authenticate(session);

    expire();
    session.close();
    await session.receiveText("null");
    deps.connector.observer?.onChallenge({
      imageDataUrl: CHALLENGE,
      expiresAt: "2026-08-30T12:02:00.000Z",
    });
    deps.connector.observer?.onDocument({
      bytes: PDF,
      mediaType: "application/pdf",
      sha256: PDF_SHA256,
    });
    deps.connector.observer?.onError("SOURCE_UNAVAILABLE");
    expire();

    expect(peer.text.at(-1)).toEqual({
      type: "error",
      code: "SESSION_EXPIRED",
      message: "A sessão expirou. Inicie uma nova tentativa.",
    });
    expect(peer.closes).toEqual([{ code: 1000, reason: "session_expired" }]);
    expect(deps.connector.renderer.close).toHaveBeenCalledOnce();
  });
});
