import type { Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import { AssistedDocumentSession } from "../application/assisted-document-session.js";
import { websocketDataToText } from "../infrastructure/websocket-data.js";
import type { PrivateApiDependencies } from "./private-api.js";
import { MAX_BODY_BYTES } from "./transport.js";

const scheduleSessionTimeout = (
  callback: () => void,
  delayMs: number,
): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

const parseDocumentSessionPath = (
  rawUrl: string | undefined,
): { cnjNumber: string; communicationNumber: string } | undefined => {
  const pathname = new URL(rawUrl ?? "/", "http://localhost").pathname;
  const match = /^\/api\/v1\/processes\/(\d{20})\/communications\/([1-9]\d*)\/document\/session$/.exec(
    pathname,
  );
  return match?.[1] && match[2]
    ? { cnjNumber: match[1], communicationNumber: match[2] }
    : undefined;
};

const rejectUpgrade = (
  socket: Duplex,
  statusCode: number,
  statusText: string,
) => {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
};

export const registerDocumentSessionUpgrade = (
  server: Server,
  dependencies: PrivateApiDependencies,
) => {
  const websocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: MAX_BODY_BYTES,
  });

  server.on("upgrade", (request, socket, head) => {
    const reference = parseDocumentSessionPath(request.url);
    if (!reference) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const {
      tokenVerifier,
      publicationLocator,
      requestRateLimiter,
      rendererConnector,
    } = dependencies;
    if (
      !tokenVerifier ||
      !publicationLocator ||
      !requestRateLimiter ||
      !rendererConnector
    ) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      const session = new AssistedDocumentSession(
        reference,
        {
          sendJson: (value) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(value));
            }
          },
          sendBinary: (value) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(value, { binary: true });
            }
          },
          close: (code, reason) => client.close(code, reason),
        },
        {
          tokenVerifier,
          publicationLocator,
          requestRateLimiter,
          rendererConnector,
        },
        { schedule: scheduleSessionTimeout },
      );
      client.on("message", (data, isBinary) => {
        if (isBinary) {
          client.close(1003, "binary_control_frame");
          return;
        }
        void session.receiveText(websocketDataToText(data));
      });
      client.once("close", () => session.close());
      client.once("error", () => client.close(1011, "socket_error"));
    });
  });
};
