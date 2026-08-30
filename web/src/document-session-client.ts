const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_CONTROL_FRAME_BYTES = 16 * 1024;
const MAX_CHALLENGE_DATA_URL_LENGTH = 1_000_000;

export interface BrowserSocket {
  readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface DocumentSessionControl {
  answer(answer: string): void;
  close(): void;
}

export interface DocumentSessionCallbacks {
  onStatus(status: "preparing"): void;
  onChallenge(challenge: {
    imageDataUrl: string;
    expiresAt: string;
    rejected?: true;
  }): void;
  onDocument(document: {
    blob: Blob;
    fileName: string;
    sha256: string;
  }): void;
  onError(code: string): void;
}

interface DocumentMetadata {
  fileName: string;
  byteLength: number;
  sha256: string;
}

const toWebSocketUrl = (path: string, baseUrl: string): string => {
  const url = new URL(path, baseUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("invalid document session base URL");
  return url.toString();
};

const parseControlFrame = (data: string): Record<string, unknown> | undefined => {
  if (data.length > MAX_CONTROL_FRAME_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const toBytes = async (data: unknown): Promise<Uint8Array | undefined> => {
  if (
    data instanceof ArrayBuffer ||
    Object.prototype.toString.call(data) === "[object ArrayBuffer]"
  ) {
    return new Uint8Array(data as ArrayBuffer);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return undefined;
};

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const allowedErrorCodes = new Set([
  "UNAUTHENTICATED",
  "RATE_LIMITED",
  "PUBLICATION_NOT_FOUND",
  "SESSION_BUSY",
  "SESSION_EXPIRED",
  "SOURCE_POLICY_REJECTED",
  "SOURCE_UNAVAILABLE",
  "DOCUMENT_INTEGRITY_REJECTED",
]);

export const openDocumentSession = ({
  path,
  token,
  baseUrl = window.location.href,
  createSocket = (url) => new WebSocket(url),
  digest = (algorithm, data) => crypto.subtle.digest(algorithm, data),
  callbacks,
}: {
  path: string;
  token: string;
  baseUrl?: string;
  createSocket?: (url: string) => BrowserSocket;
  digest?: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;
  callbacks: DocumentSessionCallbacks;
}): DocumentSessionControl => {
  if (!token || token.length > 8_192) throw new Error("invalid authentication token");
  const socket = createSocket(toWebSocketUrl(path, baseUrl));
  socket.binaryType = "arraybuffer";
  let metadata: DocumentMetadata | undefined;
  let terminal = false;
  let validatingDocument = false;

  const fail = (code: string, closeCode = 1011, reason = "session_failed") => {
    if (terminal) return;
    terminal = true;
    callbacks.onError(code);
    socket.close(closeCode, reason);
  };

  socket.onopen = () => {
    if (!terminal) {
      socket.send(JSON.stringify({ type: "authenticate", token }));
    }
  };

  socket.onmessage = (event) => {
    if (terminal) return;
    if (typeof event.data === "string") {
      const message = parseControlFrame(event.data);
      if (!message) {
        fail("SOURCE_POLICY_REJECTED", 1008, "invalid_server_frame");
        return;
      }
      if (message.type === "status" && message.status === "preparing") {
        callbacks.onStatus("preparing");
        return;
      }
      if (
        message.type === "challenge" &&
        typeof message.imageDataUrl === "string" &&
        message.imageDataUrl.length <= MAX_CHALLENGE_DATA_URL_LENGTH &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(message.imageDataUrl) &&
        typeof message.expiresAt === "string" &&
        !Number.isNaN(Date.parse(message.expiresAt))
      ) {
        callbacks.onChallenge({
          imageDataUrl: message.imageDataUrl,
          expiresAt: message.expiresAt,
          ...(message.rejected === true ? { rejected: true } : {}),
        });
        return;
      }
      if (
        message.type === "document" &&
        typeof message.fileName === "string" &&
        /^[A-Za-z0-9._-]{1,160}\.pdf$/u.test(message.fileName) &&
        message.mediaType === "application/pdf" &&
        typeof message.byteLength === "number" &&
        Number.isSafeInteger(message.byteLength) &&
        message.byteLength >= 5 &&
        message.byteLength <= MAX_DOCUMENT_BYTES &&
        typeof message.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(message.sha256)
      ) {
        metadata = {
          fileName: message.fileName,
          byteLength: message.byteLength,
          sha256: message.sha256,
        };
        return;
      }
      if (
        message.type === "error" &&
        typeof message.code === "string" &&
        allowedErrorCodes.has(message.code)
      ) {
        fail(message.code);
        return;
      }
      fail("SOURCE_POLICY_REJECTED", 1008, "invalid_server_frame");
      return;
    }

    validatingDocument = true;
    void (async () => {
      const bytes = await toBytes(event.data);
      if (
        !metadata ||
        !bytes ||
        bytes.byteLength !== metadata.byteLength ||
        bytes.byteLength < 5 ||
        bytes.byteLength > MAX_DOCUMENT_BYTES ||
        new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
      ) {
        fail("DOCUMENT_INTEGRITY_REJECTED");
        return;
      }
      const documentBytes: Uint8Array<ArrayBuffer> = new Uint8Array(
        bytes.byteLength,
      );
      documentBytes.set(bytes);
      const actualHash = toHex(await digest("SHA-256", documentBytes));
      if (actualHash !== metadata.sha256) {
        fail("DOCUMENT_INTEGRITY_REJECTED");
        return;
      }
      terminal = true;
      callbacks.onDocument({
        blob: new Blob([documentBytes], { type: "application/pdf" }),
        fileName: metadata.fileName,
        sha256: metadata.sha256,
      });
      socket.close(1000, "complete");
    })().catch(() => fail("DOCUMENT_INTEGRITY_REJECTED"));
  };

  socket.onerror = () => fail("SOURCE_UNAVAILABLE");
  socket.onclose = () => {
    if (!terminal && !validatingDocument) fail("SOURCE_UNAVAILABLE");
  };

  return {
    answer: (answer) => {
      if (!/^[A-Za-z0-9]{1,32}$/u.test(answer)) {
        throw new Error("invalid challenge answer");
      }
      if (!terminal && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "answer", answer }));
      }
    },
    close: () => {
      if (terminal) return;
      terminal = true;
      socket.close(1000, "cancelled");
    },
  };
};
