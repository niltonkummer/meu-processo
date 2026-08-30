import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openDocumentSession,
  type BrowserSocket,
} from "./document-session-client";

const PDF = new TextEncoder().encode("%PDF-1.7\nweb-client\n%%EOF");
const SHA256 = createHash("sha256").update(PDF).digest("hex");

class FakeSocket implements BrowserSocket {
  readyState = 0;
  binaryType: BinaryType = "blob";
  sent: unknown[] = [];
  closed: Array<[number | undefined, string | undefined]> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closed.push([code, reason]);
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  error() {
    this.onerror?.(new Event("error"));
  }

  serverClose() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  message(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const digest = vi.fn((_algorithm: AlgorithmIdentifier, data: BufferSource) => {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Promise.resolve(
    Uint8Array.from(
      Buffer.from(createHash("sha256").update(bytes).digest("hex"), "hex"),
    ).buffer,
  );
});

const setup = () => {
  const socket = new FakeSocket();
  const callbacks = {
    onStatus: vi.fn(),
    onChallenge: vi.fn(),
    onDocument: vi.fn(),
    onError: vi.fn(),
  };
  const control = openDocumentSession({
    path: "/api/v1/processes/123/communications/9/document/session",
    token: "firebase-token",
    baseUrl: "https://processos.example/app",
    createSocket: vi.fn(() => socket),
    digest,
    callbacks,
  });
  return { socket, callbacks, control };
};

describe("document session browser client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("authenticates without putting the token in the WebSocket URL", () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket);
    openDocumentSession({
      path: "/api/v1/processes/123/communications/9/document/session",
      token: "secret-token",
      baseUrl: "https://processos.example/app",
      createSocket,
      digest,
      callbacks: {
        onStatus: vi.fn(),
        onChallenge: vi.fn(),
        onDocument: vi.fn(),
        onError: vi.fn(),
      },
    });

    expect(createSocket).toHaveBeenCalledWith(
      "wss://processos.example/api/v1/processes/123/communications/9/document/session",
    );
    socket.open();
    expect(socket.binaryType).toBe("arraybuffer");
    expect(socket.sent).toEqual([
      JSON.stringify({ type: "authenticate", token: "secret-token" }),
    ]);
  });

  it("supports a local ws origin and rejects non-HTTP base URLs", () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket);
    const callbacks = {
      onStatus: vi.fn(),
      onChallenge: vi.fn(),
      onDocument: vi.fn(),
      onError: vi.fn(),
    };
    openDocumentSession({
      path: "/session",
      token: "token",
      baseUrl: "http://127.0.0.1:8080/app",
      createSocket,
      digest,
      callbacks,
    });
    expect(createSocket).toHaveBeenCalledWith("ws://127.0.0.1:8080/session");
    expect(() =>
      openDocumentSession({
        path: "/session",
        token: "token",
        baseUrl: "ftp://example.test/app",
        createSocket,
        digest,
        callbacks,
      }),
    ).toThrow("invalid document session base URL");
  });

  it.each(["", "x".repeat(8_193)])("rejects an invalid token", (token) => {
    expect(() =>
      openDocumentSession({
        path: "/session",
        token,
        baseUrl: "https://example.test",
        createSocket: vi.fn(() => new FakeSocket()),
        digest,
        callbacks: {
          onStatus: vi.fn(),
          onChallenge: vi.fn(),
          onDocument: vi.fn(),
          onError: vi.fn(),
        },
      }),
    ).toThrow("invalid authentication token");
  });

  it("forwards a PNG challenge and a bounded human answer", () => {
    const context = setup();
    context.socket.open();
    context.socket.message(
      JSON.stringify({
        type: "challenge",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        expiresAt: "2026-08-30T12:02:00.000Z",
        rejected: true,
      }),
    );
    expect(context.callbacks.onChallenge).toHaveBeenCalledWith({
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      expiresAt: "2026-08-30T12:02:00.000Z",
      rejected: true,
    });

    context.control.answer("A19b");
    expect(context.socket.sent.at(-1)).toBe(
      JSON.stringify({ type: "answer", answer: "A19b" }),
    );
    expect(() => context.control.answer("<script>")).toThrow(
      "invalid challenge answer",
    );
    context.socket.message(
      JSON.stringify({
        type: "challenge",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        expiresAt: "2026-08-30T12:02:00.000Z",
      }),
    );
    expect(context.callbacks.onChallenge).toHaveBeenLastCalledWith({
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      expiresAt: "2026-08-30T12:02:00.000Z",
    });
  });

  it("validates PDF size, signature and SHA before returning it", async () => {
    const context = setup();
    context.socket.open();
    context.socket.message(JSON.stringify({ type: "status", status: "preparing" }));
    expect(context.callbacks.onStatus).toHaveBeenCalledWith("preparing");
    context.socket.message(
      JSON.stringify({
        type: "document",
        fileName: "processo.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: SHA256,
      }),
    );
    context.socket.message(PDF.buffer.slice(0));

    await vi.waitFor(() =>
      expect(
        context.callbacks.onDocument.mock.calls.length +
          context.callbacks.onError.mock.calls.length,
      ).toBeGreaterThan(0),
    );
    expect(digest).toHaveBeenCalled();
    expect(context.callbacks.onError).not.toHaveBeenCalled();
    expect(context.callbacks.onDocument).toHaveBeenCalledOnce();
    expect(context.callbacks.onDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "processo.pdf", sha256: SHA256 }),
    );
    const value = context.callbacks.onDocument.mock.calls[0]?.[0] as {
      blob: Blob;
    };
    expect(await value.blob.text()).toBe(new TextDecoder().decode(PDF));
    expect(context.callbacks.onError).not.toHaveBeenCalled();
  });

  it("fails closed on malformed control frames or mismatched document bytes", async () => {
    const malformed = setup();
    malformed.socket.open();
    malformed.socket.message("not-json");
    expect(malformed.callbacks.onError).toHaveBeenCalledWith(
      "SOURCE_POLICY_REJECTED",
    );
    expect(malformed.socket.closed).toContainEqual([1008, "invalid_server_frame"]);

    const mismatched = setup();
    mismatched.socket.open();
    mismatched.socket.message(
      JSON.stringify({
        type: "document",
        fileName: "processo.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: "0".repeat(64),
      }),
    );
    mismatched.socket.message(PDF.buffer.slice(0));
    await vi.waitFor(() =>
      expect(mismatched.callbacks.onError).toHaveBeenCalledWith(
        "DOCUMENT_INTEGRITY_REJECTED",
      ),
    );
    expect(mismatched.callbacks.onDocument).not.toHaveBeenCalled();
  });

  it.each(["null", JSON.stringify({ type: "unknown" }), "x".repeat(16_385)])(
    "rejects an invalid control frame",
    (frame) => {
      const context = setup();
      context.socket.open();
      context.socket.message(frame);
      expect(context.callbacks.onError).toHaveBeenCalledWith(
        "SOURCE_POLICY_REJECTED",
      );
    },
  );

  it("accepts typed-array and Blob binary frames", async () => {
    for (const data of [PDF, new Blob([PDF])]) {
      const context = setup();
      context.socket.open();
      context.socket.message(
        JSON.stringify({
          type: "document",
          fileName: "processo.pdf",
          mediaType: "application/pdf",
          byteLength: PDF.byteLength,
          sha256: SHA256,
        }),
      );
      context.socket.message(data);
      await vi.waitFor(() =>
        expect(context.callbacks.onDocument).toHaveBeenCalledOnce(),
      );
    }
  });

  it("rejects binary data without valid metadata and digest failures", async () => {
    const missingMetadata = setup();
    missingMetadata.socket.open();
    missingMetadata.socket.message({ unsupported: true });
    await vi.waitFor(() =>
      expect(missingMetadata.callbacks.onError).toHaveBeenCalledWith(
        "DOCUMENT_INTEGRITY_REJECTED",
      ),
    );

    const digestFailure = setup();
    digestFailure.socket.open();
    digestFailure.socket.message(
      JSON.stringify({
        type: "document",
        fileName: "processo.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: SHA256,
      }),
    );
    const rejectingDigest = vi
      .fn<(algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>>()
      .mockRejectedValue(new Error("digest unavailable"));
    const replacement = new FakeSocket();
    const callbacks = {
      onStatus: vi.fn(),
      onChallenge: vi.fn(),
      onDocument: vi.fn(),
      onError: vi.fn(),
    };
    openDocumentSession({
      path: "/session",
      token: "token",
      baseUrl: "https://example.test",
      createSocket: () => replacement,
      digest: rejectingDigest,
      callbacks,
    });
    replacement.open();
    replacement.message(
      JSON.stringify({
        type: "document",
        fileName: "processo.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: SHA256,
      }),
    );
    replacement.message(PDF);
    await vi.waitFor(() =>
      expect(callbacks.onError).toHaveBeenCalledWith(
        "DOCUMENT_INTEGRITY_REJECTED",
      ),
    );
  });

  it("maps socket errors, premature closes and explicit cancellation once", () => {
    const socketError = setup();
    socketError.socket.error();
    socketError.socket.error();
    expect(socketError.callbacks.onError).toHaveBeenCalledTimes(1);

    const prematureClose = setup();
    prematureClose.socket.serverClose();
    expect(prematureClose.callbacks.onError).toHaveBeenCalledWith(
      "SOURCE_UNAVAILABLE",
    );

    const cancelled = setup();
    cancelled.control.answer("A19b");
    expect(cancelled.socket.sent).toEqual([]);
    cancelled.control.close();
    cancelled.socket.open();
    cancelled.socket.message(JSON.stringify({ type: "status", status: "preparing" }));
    cancelled.socket.error();
    cancelled.socket.serverClose();
    cancelled.control.close();
    expect(cancelled.socket.closed).toEqual([[1000, "cancelled"]]);
    expect(cancelled.callbacks.onError).not.toHaveBeenCalled();
  });

  it("does not treat a close during asynchronous document validation as a source failure", async () => {
    let resolveDigest!: (value: ArrayBuffer) => void;
    const pendingDigest = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveDigest = resolve;
        }),
    );
    const socket = new FakeSocket();
    const callbacks = {
      onStatus: vi.fn(),
      onChallenge: vi.fn(),
      onDocument: vi.fn(),
      onError: vi.fn(),
    };
    openDocumentSession({
      path: "/session",
      token: "token",
      baseUrl: "https://example.test",
      createSocket: () => socket,
      digest: pendingDigest,
      callbacks,
    });
    socket.open();
    socket.message(
      JSON.stringify({
        type: "document",
        fileName: "processo.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: SHA256,
      }),
    );
    socket.message(PDF);
    await vi.waitFor(() => expect(pendingDigest).toHaveBeenCalledOnce());
    socket.serverClose();
    expect(callbacks.onError).not.toHaveBeenCalled();
    resolveDigest(
      Uint8Array.from(Buffer.from(SHA256, "hex")).buffer,
    );
    await vi.waitFor(() => expect(callbacks.onDocument).toHaveBeenCalledOnce());
  });

  it("uses the browser WebSocket and SubtleCrypto defaults", async () => {
    const socket = new FakeSocket();
    class DefaultSocket {
      static readonly OPEN = 1;
      constructor(url: string) {
        void url;
        return socket;
      }
    }
    vi.stubGlobal("WebSocket", DefaultSocket);
    vi.stubGlobal("crypto", { subtle: { digest } });
    const callbacks = {
      onStatus: vi.fn(),
      onChallenge: vi.fn(),
      onDocument: vi.fn(),
      onError: vi.fn(),
    };
    openDocumentSession({
      path: "/session",
      token: "token",
      callbacks,
    });
    socket.open();
    socket.message(
      JSON.stringify({
        type: "document",
        fileName: "processo.pdf",
        mediaType: "application/pdf",
        byteLength: PDF.byteLength,
        sha256: SHA256,
      }),
    );
    socket.message(PDF);
    await vi.waitFor(() => expect(callbacks.onDocument).toHaveBeenCalledOnce());
  });

  it("cancels explicitly and maps a server error only once", () => {
    const context = setup();
    context.socket.open();
    context.socket.message(
      JSON.stringify({ type: "error", code: "SESSION_EXPIRED" }),
    );
    context.socket.message(
      JSON.stringify({ type: "error", code: "SOURCE_UNAVAILABLE" }),
    );
    context.control.close();
    expect(context.callbacks.onError).toHaveBeenCalledTimes(1);
    expect(context.callbacks.onError).toHaveBeenCalledWith("SESSION_EXPIRED");
  });
});
