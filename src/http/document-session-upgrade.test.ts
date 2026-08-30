import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import type {
  AssistedRendererObserver,
  AssistedRendererSession,
} from "../application/assisted-document-session.js";
import type { TokenVerifier } from "../application/authentication.js";
import { websocketDataToText } from "../infrastructure/websocket-data.js";
import { createAppServer } from "./server.js";

const SOURCE_URL = "https://eproc1g.tjrs.jus.br/document";
const CHALLENGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const PDF = new TextEncoder().encode("%PDF-1.7\ngateway\n%%EOF");

const servers: ReturnType<typeof createAppServer>[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.terminate();
    }
  });
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

const start = async ({
  verify = vi.fn<TokenVerifier["verify"]>(() =>
    Promise.resolve({ userId: "user-a", memberships: [] }),
  ),
}: { verify?: TokenVerifier["verify"] } = {}) => {
  const renderer: AssistedRendererSession = {
    sendAnswer: vi.fn(),
    close: vi.fn(),
  };
  let observer: AssistedRendererObserver | undefined;
  const rendererConnector = {
    connect: vi.fn((_input, nextObserver: AssistedRendererObserver) => {
      observer = nextObserver;
      return Promise.resolve(renderer);
    }),
  };
  const locator = {
    findCommunication: vi.fn(() =>
      Promise.resolve({
        numeroProcesso: "5015790-60.2026.8.21.0003",
        numeroComunicacao: 37884,
        link: SOURCE_URL,
        tipoDocumento: "Intimação",
      }),
    ),
  };
  const server = createAppServer({
    client: { search: vi.fn() },
    tokenVerifier: { verify },
    publicationLocator: locator,
    requestRateLimiter: { allow: vi.fn(() => true) },
    rendererConnector,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `ws://127.0.0.1:${port}`,
    renderer,
    rendererConnector,
    locator,
    getObserver: () => observer,
  };
};

const connect = async (baseUrl: string) => {
  const socket = new WebSocket(
    `${baseUrl}/api/v1/processes/50157906020268210003/communications/37884/document/session`,
  );
  clients.push(socket);
  const messages: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
  const closed = new Promise<void>((resolve) =>
    socket.once("close", () => resolve()),
  );
  socket.on("message", (data, isBinary) => messages.push({ data, isBinary }));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, messages, closed };
};

describe("document session WebSocket upgrade", () => {
  it("authenticates, resolves DJEN and bridges challenge, answer and PDF", async () => {
    const context = await start();
    const { socket, messages, closed } = await connect(context.baseUrl);

    socket.send(JSON.stringify({ type: "authenticate", token: "token-a" }));
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(JSON.parse(messages[0] ? websocketDataToText(messages[0].data) : "")).toEqual({
      type: "status",
      status: "preparing",
    });
    expect(context.rendererConnector.connect).toHaveBeenCalledWith(
      {
        sourceUrl: SOURCE_URL,
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      },
      expect.any(Object),
    );

    context.getObserver()?.onChallenge({
      imageDataUrl: CHALLENGE,
      expiresAt: "2026-08-30T12:02:00.000Z",
    });
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    socket.send(JSON.stringify({ type: "answer", answer: "A1B2C3" }));
    await vi.waitFor(() =>
      expect(context.renderer.sendAnswer).toHaveBeenCalledWith("A1B2C3"),
    );

    const sha256 = createHash("sha256").update(PDF).digest("hex");
    context.getObserver()?.onDocument({
      bytes: PDF,
      mediaType: "application/pdf",
      sha256,
    });
    await vi.waitFor(() => expect(messages).toHaveLength(4));
    expect(JSON.parse(messages[2] ? websocketDataToText(messages[2].data) : "")).toEqual({
      type: "document",
      fileName: "5015790-60.2026.8.21.0003-comunicacao-37884.pdf",
      mediaType: "application/pdf",
      byteLength: PDF.byteLength,
      sha256,
    });
    expect(messages[3]?.isBinary).toBe(true);
    await closed;
  });

  it("rejects unauthenticated and malformed references before DJEN", async () => {
    const context = await start({
      verify: vi.fn(() => Promise.reject(new Error("invalid"))),
    });
    const unauthenticated = await connect(context.baseUrl);
    unauthenticated.socket.send(
      JSON.stringify({ type: "authenticate", token: "bad" }),
    );
    await vi.waitFor(() => expect(unauthenticated.messages).toHaveLength(1));
    expect(
      JSON.parse(
        unauthenticated.messages[0]
          ? websocketDataToText(unauthenticated.messages[0].data)
          : "",
      ),
    ).toMatchObject({
      type: "error",
      code: "UNAUTHENTICATED",
    });
    expect(context.locator.findCommunication).not.toHaveBeenCalled();

    const status = await new Promise<number>((resolve) => {
      const invalid = new WebSocket(
        `${context.baseUrl}/api/v1/processes/not-cnj/communications/1/document/session`,
      );
      clients.push(invalid);
      invalid.once("unexpected-response", (_request, response) =>
        resolve(response.statusCode ?? 0),
      );
    });
    expect(status).toBe(404);
  });
});
