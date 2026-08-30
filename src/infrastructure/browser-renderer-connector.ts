import { createHash } from "node:crypto";

import { GoogleAuth } from "google-auth-library";
import WebSocket from "ws";

import type {
  AssistedRendererConnector,
  AssistedRendererObserver,
  AssistedRendererSession,
} from "../application/assisted-document-session.js";
import { websocketDataToText } from "./websocket-data.js";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_CONTROL_FRAME_BYTES = 16 * 1024;

export interface IdTokenProvider {
  getToken(audience: string): Promise<string>;
}

export class GoogleCloudIdTokenProvider implements IdTokenProvider {
  readonly #auth: GoogleAuth;

  constructor(auth = new GoogleAuth()) {
    this.#auth = auth;
  }

  async getToken(audience: string): Promise<string> {
    const client = await this.#auth.getIdTokenClient(audience);
    const headers = await client.getRequestHeaders(audience);
    const authorization = headers.get("authorization");
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Cloud Run identity token unavailable.");
    return token;
  }
}

interface RendererMetadata {
  byteLength: number;
  sha256: string;
}

const websocketUrl = (endpoint: string): string => {
  const url = new URL(endpoint);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("Renderer endpoint must use HTTP or HTTPS.");
  url.pathname = "/internal/v1/document-session";
  url.search = "";
  url.hash = "";
  return url.toString();
};

const parseJson = (value: WebSocket.RawData): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(websocketDataToText(value));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const rendererErrorCodes = new Set([
  "SESSION_BUSY",
  "SESSION_EXPIRED",
  "SOURCE_POLICY_REJECTED",
  "SOURCE_UNAVAILABLE",
  "DOCUMENT_INTEGRITY_REJECTED",
]);

export class CloudRunBrowserRendererConnector
  implements AssistedRendererConnector
{
  readonly #endpoint: string;
  readonly #tokenProvider: IdTokenProvider;

  constructor({
    endpoint,
    tokenProvider,
  }: {
    endpoint: string;
    tokenProvider: IdTokenProvider;
  }) {
    this.#endpoint = endpoint;
    this.#tokenProvider = tokenProvider;
  }

  async connect(
    input: {
      sourceUrl: string;
      cnjNumber: string;
      communicationNumber: number;
    },
    observer: AssistedRendererObserver,
  ): Promise<AssistedRendererSession> {
    const token = await this.#tokenProvider.getToken(this.#endpoint);
    const socket = new WebSocket(websocketUrl(this.#endpoint), {
      headers: { authorization: `Bearer ${token}` },
      perMessageDeflate: false,
      maxPayload: MAX_DOCUMENT_BYTES + MAX_CONTROL_FRAME_BYTES,
      handshakeTimeout: 10_000,
    });
    let metadata: RendererMetadata | undefined;
    let terminal = false;

    const fail = (
      code:
        | "SESSION_BUSY"
        | "SESSION_EXPIRED"
        | "SOURCE_POLICY_REJECTED"
        | "SOURCE_UNAVAILABLE"
        | "DOCUMENT_INTEGRITY_REJECTED",
    ) => {
      if (terminal) return;
      terminal = true;
      observer.onError(code);
      socket.close(1011, code.toLowerCase());
    };

    socket.on("message", (data, isBinary) => {
      if (terminal) return;
      if (isBinary) {
        const bytes = new Uint8Array(data as Buffer);
        if (
          !metadata ||
          bytes.byteLength !== metadata.byteLength ||
          bytes.byteLength < 5 ||
          bytes.byteLength > MAX_DOCUMENT_BYTES ||
          new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-" ||
          createHash("sha256").update(bytes).digest("hex") !== metadata.sha256
        ) {
          fail("DOCUMENT_INTEGRITY_REJECTED");
          return;
        }
        terminal = true;
        observer.onDocument({
          bytes,
          mediaType: "application/pdf",
          sha256: metadata.sha256,
        });
        socket.close(1000, "complete");
        return;
      }

      const message = parseJson(data);
      if (!message) {
        fail("SOURCE_POLICY_REJECTED");
        return;
      }
      if (
        message.type === "challenge" &&
        typeof message.imageDataUrl === "string" &&
        typeof message.expiresAt === "string" &&
        message.imageDataUrl.length <= 1_000_000 &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(message.imageDataUrl) &&
        !Number.isNaN(Date.parse(message.expiresAt))
      ) {
        observer.onChallenge({
          imageDataUrl: message.imageDataUrl,
          expiresAt: message.expiresAt,
          ...(message.rejected === true ? { rejected: true } : {}),
        });
        return;
      }
      if (
        message.type === "document" &&
        message.mediaType === "application/pdf" &&
        typeof message.byteLength === "number" &&
        Number.isSafeInteger(message.byteLength) &&
        message.byteLength >= 5 &&
        message.byteLength <= MAX_DOCUMENT_BYTES &&
        typeof message.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(message.sha256)
      ) {
        metadata = {
          byteLength: message.byteLength,
          sha256: message.sha256,
        };
        return;
      }
      if (
        message.type === "error" &&
        typeof message.code === "string" &&
        rendererErrorCodes.has(message.code)
      ) {
        fail(
          message.code as
            | "SESSION_BUSY"
            | "SESSION_EXPIRED"
            | "SOURCE_POLICY_REJECTED"
            | "SOURCE_UNAVAILABLE"
            | "DOCUMENT_INTEGRITY_REJECTED",
        );
        return;
      }
      fail("SOURCE_POLICY_REJECTED");
    });
    socket.once("close", () => {
      if (!terminal) fail("SOURCE_UNAVAILABLE");
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("error", () => {
      if (!terminal) fail("SOURCE_UNAVAILABLE");
    });
    socket.send(JSON.stringify({ type: "open", ...input }));

    return {
      sendAnswer: (answer) => {
        if (!terminal && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "answer", answer }));
        }
      },
      close: () => {
        terminal = true;
        socket.close(1000, "gateway_closed");
      },
    };
  }
}
