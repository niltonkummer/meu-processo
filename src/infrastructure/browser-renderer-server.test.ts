import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import type {
  BrowserChallengeDriver,
  BrowserChallengeDriverFactory,
} from "../application/browser-renderer-session.js";
import {
  createBrowserRendererServer,
  writeRendererSessionEvent,
} from "./browser-renderer-server.js";
import { websocketDataToText } from "./websocket-data.js";

const SOURCE_URL =
  "https://eproc1g.tjrs.jus.br/eproc/controlador.php?acao=acessar_documento_publico";
const CHALLENGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const PDF = new TextEncoder().encode("%PDF-1.7\nserver\n%%EOF");

const servers: Array<ReturnType<typeof createBrowserRendererServer>> = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.terminate());
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

const start = async (
  factory: BrowserChallengeDriverFactory,
  logEvent = vi.fn(),
) => {
  const server = createBrowserRendererServer({ driverFactory: factory, logEvent });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `ws://127.0.0.1:${port}`, logEvent };
};

const connect = (url: string) =>
  new Promise<{
    socket: WebSocket;
    messages: Array<{ data: WebSocket.RawData; isBinary: boolean }>;
    closed: Promise<void>;
  }>((resolve, reject) => {
    const socket = new WebSocket(`${url}/internal/v1/document-session`);
    const messages: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
    const closed = new Promise<void>((closeResolve) =>
      socket.once("close", () => closeResolve()),
    );
    socket.on("message", (data, isBinary) => messages.push({ data, isBinary }));
    clients.push(socket);
    socket.once("open", () => resolve({ socket, messages, closed }));
    socket.once("error", reject);
  });

const waitForMessages = async (
  messages: Array<{ data: WebSocket.RawData; isBinary: boolean }>,
  count: number,
) => {
  await vi.waitFor(() => expect(messages).toHaveLength(count));
  return messages;
};

describe("createBrowserRendererServer", () => {
  it("writes the safe session event as structured JSON", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const event = {
      event: "document_renderer_session_closed" as const,
      correlationId: "5ef06ed6-f0c9-41fe-80c2-d715ce637480",
      outcome: "source_unavailable",
      durationMs: 38_000,
    };

    writeRendererSessionEvent(event);

    expect(consoleLog).toHaveBeenCalledWith(JSON.stringify(event));
    consoleLog.mockRestore();
  });

  it("serves health and runs one complete challenge session", async () => {
    const driver = {
      open: vi.fn(() => Promise.resolve({
        type: "challenge" as const,
        imageDataUrl: CHALLENGE,
        expiresAt: "2026-08-30T12:02:00.000Z",
      })),
      submit: vi.fn(() => Promise.resolve({ type: "document" as const, bytes: PDF })),
      close: vi.fn(() => Promise.resolve()),
    } satisfies BrowserChallengeDriver;
    const { url, logEvent } = await start({
      create: vi.fn(() => Promise.resolve(driver)),
    });
    const health = await fetch(url.replace("ws:", "http:") + "/health");

    expect(await health.json()).toEqual({ ok: true });
    expect(health.headers.get("cache-control")).toBe("no-store");

    const { socket, messages, closed } = await connect(url);
    socket.send(
      JSON.stringify({
        type: "open",
        sourceUrl: SOURCE_URL,
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    );
    const [challenge] = await waitForMessages(messages, 1);
    expect(challenge).toBeDefined();
    if (!challenge) throw new Error("challenge missing");
    expect(challenge.isBinary).toBe(false);
    expect(JSON.parse(websocketDataToText(challenge.data))).toEqual({
      type: "challenge",
      imageDataUrl: CHALLENGE,
      expiresAt: "2026-08-30T12:02:00.000Z",
    });

    socket.send(JSON.stringify({ type: "answer", answer: "A1B2C3" }));
    const [, metadata, binary] = await waitForMessages(messages, 3);
    if (!metadata || !binary) throw new Error("document frames missing");
    expect(JSON.parse(websocketDataToText(metadata.data))).toMatchObject({
      type: "document",
      mediaType: "application/pdf",
      byteLength: PDF.byteLength,
    });
    expect(binary.isBinary).toBe(true);
    expect(Array.from(new Uint8Array(binary.data as Buffer))).toEqual(
      Array.from(PDF),
    );
    await closed;
    expect(driver.close).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith({
      event: "document_renderer_session_closed",
      correlationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      outcome: "complete",
      durationMs: expect.any(Number),
    });
  });

  it("rejects a second concurrent browser session without creating a driver", async () => {
    const firstDriver = {
      open: vi.fn(() => new Promise<never>(() => undefined)),
      submit: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
    } satisfies BrowserChallengeDriver;
    const factory = { create: vi.fn(() => Promise.resolve(firstDriver)) };
    const { url } = await start(factory);
    const { socket: first } = await connect(url);
    first.send(
      JSON.stringify({
        type: "open",
        sourceUrl: SOURCE_URL,
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    );
    await vi.waitFor(() => expect(factory.create).toHaveBeenCalledOnce());

    const { socket: second, messages } = await connect(url);
    const [busy] = await waitForMessages(messages, 1);
    if (!busy) throw new Error("busy frame missing");
    expect(JSON.parse(websocketDataToText(busy.data))).toEqual({
      type: "error",
      code: "SESSION_BUSY",
    });
    expect(factory.create).toHaveBeenCalledOnce();
    first.terminate();
    second.terminate();
  });

  it("rejects unknown HTTP and WebSocket paths", async () => {
    const { url } = await start({
      create: vi.fn(() => Promise.reject(new Error("must not create"))),
    });

    const missing = await fetch(url.replace("ws:", "http:") + "/missing");
    expect(missing.status).toBe(404);

    const status = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`${url}/wrong`);
      socket.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
    });
    expect(status).toBe(404);
  });
});
