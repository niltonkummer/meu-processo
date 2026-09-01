import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import {
  BrowserRendererSession,
  type BrowserChallengeDriverFactory,
} from "../application/browser-renderer-session.js";
import { websocketDataToText } from "./websocket-data.js";

const MAX_CONTROL_FRAME_BYTES = 16 * 1024;
const SAFE_SESSION_OUTCOMES = new Set([
  "cancelled",
  "complete",
  "document_integrity_rejected",
  "invalid_challenge_answer",
  "session_expired",
  "source_policy_rejected",
  "source_unavailable",
]);

interface RendererSessionClosedEvent {
  event: "document_renderer_session_closed";
  correlationId: string;
  outcome: string;
  durationMs: number;
}

export const writeRendererSessionEvent = (
  event: RendererSessionClosedEvent,
): void => console.log(JSON.stringify(event));

const schedule = (callback: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

const rejectUpgrade = (
  socket: import("node:stream").Duplex,
  statusCode: number,
  statusText: string,
) => {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
};

export const createBrowserRendererServer = ({
  driverFactory,
  logEvent = writeRendererSessionEvent,
}: {
  driverFactory: BrowserChallengeDriverFactory;
  logEvent?: (event: RendererSessionClosedEvent) => void;
}) => {
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: "NOT_FOUND" }));
  });
  const websocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: MAX_CONTROL_FRAME_BYTES,
  });
  let active = false;

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://renderer").pathname;
    if (path !== "/internal/v1/document-session") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (socket) => {
    if (active) {
      socket.send(JSON.stringify({ type: "error", code: "SESSION_BUSY" }));
      socket.close(1013, "session_busy");
      return;
    }
    active = true;
    const correlationId = randomUUID();
    const startedAt = Date.now();
    let outcomeRecorded = false;
    const recordOutcome = (reason: string) => {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      logEvent({
        event: "document_renderer_session_closed",
        correlationId,
        outcome: SAFE_SESSION_OUTCOMES.has(reason) ? reason : "closed",
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    };
    const session = new BrowserRendererSession(
      {
        sendJson: (value) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(value));
          }
        },
        sendBinary: (value) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(value, { binary: true });
          }
        },
        close: (code, reason) => {
          recordOutcome(reason);
          socket.close(code, reason);
        },
      },
      driverFactory,
      { schedule },
    );

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        recordOutcome("source_policy_rejected");
        socket.close(1003, "binary_control_frame");
        return;
      }
      void session.receiveText(websocketDataToText(data));
    });
    socket.once("close", () => {
      recordOutcome("cancelled");
      session.close();
      active = false;
    });
    socket.once("error", () => {
      recordOutcome("source_unavailable");
      socket.close(1011, "socket_error");
    });
  });

  return server;
};
