import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import {
  CloudRunBrowserRendererConnector,
  type IdTokenProvider,
} from "./browser-renderer-connector.js";
import { websocketDataToText } from "./websocket-data.js";

const PDF = new TextEncoder().encode("%PDF-1.7\nconnector\n%%EOF");
const SHA256 = createHash("sha256").update(PDF).digest("hex");
const CHALLENGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

const startRenderer = async () => {
  const requests: Array<{ authorization?: string; first?: unknown; answer?: unknown }> = [];
  const server = createServer();
  servers.push(server);
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const ws = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    ws.handleUpgrade(request, socket, head, (client) => {
      const record: (typeof requests)[number] = {
        ...(typeof request.headers.authorization === "string"
          ? { authorization: request.headers.authorization }
          : {}),
      };
      requests.push(record);
      ws.emit("connection", client, request);
      client.on("message", (data) => {
        const message: unknown = JSON.parse(websocketDataToText(data));
        if (!record.first) {
          record.first = message;
          client.send(
            JSON.stringify({
              type: "challenge",
              imageDataUrl: CHALLENGE,
              expiresAt: "2026-08-30T12:02:00.000Z",
            }),
          );
          return;
        }
        record.answer = message;
        client.send(
          JSON.stringify({
            type: "document",
            mediaType: "application/pdf",
            byteLength: PDF.byteLength,
            sha256: SHA256,
          }),
        );
        client.send(PDF, { binary: true });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    destroy: () => sockets.forEach((socket) => socket.destroy()),
  };
};

describe("CloudRunBrowserRendererConnector", () => {
  it("uses an audience token and converts renderer frames into bounded events", async () => {
    const renderer = await startRenderer();
    const tokenProvider = {
      getToken: vi.fn(() => Promise.resolve("service-token")),
    } satisfies IdTokenProvider;
    const connector = new CloudRunBrowserRendererConnector({
      endpoint: renderer.endpoint,
      tokenProvider,
    });
    const onChallenge = vi.fn();
    const onDocument = vi.fn();
    const onError = vi.fn();

    const session = await connector.connect(
      {
        sourceUrl: "https://eproc1g.tjrs.jus.br/document",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      },
      { onChallenge, onDocument, onError },
    );
    await vi.waitFor(() => expect(onChallenge).toHaveBeenCalledOnce());
    session.sendAnswer("A1B2C3");
    await vi.waitFor(() => expect(onDocument).toHaveBeenCalledOnce());

    expect(tokenProvider.getToken).toHaveBeenCalledWith(renderer.endpoint);
    expect(renderer.requests).toEqual([
      {
        authorization: "Bearer service-token",
        first: {
          type: "open",
          sourceUrl: "https://eproc1g.tjrs.jus.br/document",
          cnjNumber: "50157906020268210003",
          communicationNumber: 37884,
        },
        answer: { type: "answer", answer: "A1B2C3" },
      },
    ]);
    expect(onDocument).toHaveBeenCalledOnce();
    const document = onDocument.mock.calls[0]?.[0] as {
      bytes: Uint8Array;
      mediaType: string;
      sha256: string;
    };
    expect(Array.from(document.bytes)).toEqual(Array.from(PDF));
    expect(document.mediaType).toBe("application/pdf");
    expect(document.sha256).toBe(SHA256);
    expect(onError).not.toHaveBeenCalled();
    session.close();
    renderer.destroy();
  });

  it("rejects malformed metadata and unexpected binary frames", async () => {
    const server = createServer();
    servers.push(server);
    const ws = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      ws.handleUpgrade(request, socket, head, (client) => {
        client.once("message", () => {
          client.send(new Uint8Array([1, 2, 3]), { binary: true });
        });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const connector = new CloudRunBrowserRendererConnector({
      endpoint: `http://127.0.0.1:${port}`,
      tokenProvider: { getToken: vi.fn(() => Promise.resolve("token")) },
    });
    const onError = vi.fn();

    await connector.connect(
      {
        sourceUrl: "https://eproc1g.tjrs.jus.br/document",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      },
      { onChallenge: vi.fn(), onDocument: vi.fn(), onError },
    );

    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith("DOCUMENT_INTEGRITY_REJECTED"),
    );
  });
});
