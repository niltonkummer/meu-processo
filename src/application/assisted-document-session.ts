import { createHash } from "node:crypto";

import type { TokenVerifier } from "./authentication.js";
import {
  parsePublicationReference,
  PublicationNotFoundError,
  PublicationReferenceInvalidError,
  resolveAuthorizedPublication,
  type DjenPublicationLocator,
} from "./publication-proxy.js";
import type { RequestRateLimiter } from "./request-rate-limiter.js";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 8_192;
const SESSION_TIMEOUT_MS = 120_000;
const RATE_WINDOW_MS = 60_000;
const DOCUMENT_RATE_LIMIT = 20;

export interface DocumentSessionPeer {
  sendJson(value: unknown): void;
  sendBinary(value: Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface AssistedRendererDocument {
  bytes: Uint8Array;
  mediaType: "application/pdf";
  sha256: string;
}

export interface AssistedRendererObserver {
  onChallenge(challenge: {
    imageDataUrl: string;
    expiresAt: string;
    rejected?: boolean;
  }): void;
  onDocument(document: AssistedRendererDocument): void;
  onError(code: RendererErrorCode): void;
}

export interface AssistedRendererSession {
  sendAnswer(answer: string): void;
  close(): void;
}

export interface AssistedRendererConnector {
  connect(
    input: {
      sourceUrl: string;
      cnjNumber: string;
      communicationNumber: number;
    },
    observer: AssistedRendererObserver,
  ): Promise<AssistedRendererSession>;
}

type RendererErrorCode =
  | "SESSION_BUSY"
  | "SESSION_EXPIRED"
  | "SOURCE_POLICY_REJECTED"
  | "SOURCE_UNAVAILABLE"
  | "DOCUMENT_INTEGRITY_REJECTED";

interface SessionDependencies {
  tokenVerifier: TokenVerifier;
  publicationLocator: DjenPublicationLocator;
  requestRateLimiter: RequestRateLimiter;
  rendererConnector: AssistedRendererConnector;
}

interface SessionOptions {
  schedule(callback: () => void, delayMs: number): () => void;
}

type State =
  | "awaiting_auth"
  | "connecting"
  | "awaiting_renderer"
  | "awaiting_answer"
  | "closed";

const parseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const validAnswer = (answer: unknown): answer is string =>
  typeof answer === "string" && /^[A-Za-z0-9]{1,32}$/.test(answer);

const validChallenge = (value: {
  imageDataUrl: string;
  expiresAt: string;
}): boolean =>
  value.imageDataUrl.length <= 1_000_000 &&
  /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(value.imageDataUrl) &&
  !Number.isNaN(Date.parse(value.expiresAt));

const validDocument = (document: AssistedRendererDocument): boolean => {
  if (
    document.mediaType !== "application/pdf" ||
    document.bytes.byteLength < 5 ||
    document.bytes.byteLength > MAX_DOCUMENT_BYTES ||
    !/^[a-f0-9]{64}$/.test(document.sha256)
  ) {
    return false;
  }
  const prefix = new TextDecoder().decode(document.bytes.subarray(0, 5));
  const actual = createHash("sha256").update(document.bytes).digest("hex");
  return prefix === "%PDF-" && actual === document.sha256;
};

const rendererMessages: Record<RendererErrorCode, string> = {
  SESSION_BUSY: "O serviço de validação está ocupado. Tente novamente em instantes.",
  SESSION_EXPIRED: "A sessão expirou. Inicie uma nova tentativa.",
  SOURCE_POLICY_REJECTED:
    "A página oficial foi bloqueada pela política de segurança.",
  SOURCE_UNAVAILABLE: "A página oficial não concluiu a abertura do documento.",
  DOCUMENT_INTEGRITY_REJECTED:
    "O documento recebido não passou pela validação de integridade.",
};

export class AssistedDocumentSession {
  readonly #reference: {
    cnjNumber: string;
    communicationNumber: string;
  };
  readonly #peer: DocumentSessionPeer;
  readonly #dependencies: SessionDependencies;
  readonly #cancelTimeout: () => void;
  #state: State = "awaiting_auth";
  #renderer?: AssistedRendererSession;
  #fileName = "documento.pdf";

  constructor(
    reference: { cnjNumber: string; communicationNumber: string },
    peer: DocumentSessionPeer,
    dependencies: SessionDependencies,
    options: SessionOptions,
  ) {
    this.#reference = reference;
    this.#peer = peer;
    this.#dependencies = dependencies;
    this.#cancelTimeout = options.schedule(
      () => this.#expire(),
      SESSION_TIMEOUT_MS,
    );
  }

  async receiveText(text: string): Promise<void> {
    if (this.#isClosed()) return;
    const message = parseObject(text);
    if (!message) {
      this.#invalidMessage();
      return;
    }

    if (this.#state === "awaiting_auth") {
      await this.#authenticate(message);
      return;
    }

    if (this.#state === "awaiting_answer") {
      if (message.type !== "answer" || !validAnswer(message.answer)) {
        this.#fail(
          "INVALID_CHALLENGE_ANSWER",
          "Use apenas letras e números no código de segurança.",
          1008,
          "invalid_challenge_answer",
        );
        return;
      }
      this.#state = "awaiting_renderer";
      this.#renderer?.sendAnswer(message.answer);
      return;
    }

    this.#invalidMessage();
  }

  close(): void {
    this.#finish(1000, "cancelled");
  }

  async #authenticate(message: Record<string, unknown>): Promise<void> {
    if (
      message.type !== "authenticate" ||
      typeof message.token !== "string" ||
      message.token.length === 0 ||
      message.token.length > MAX_TOKEN_LENGTH
    ) {
      this.#invalidMessage();
      return;
    }

    let principal;
    try {
      principal = await this.#dependencies.tokenVerifier.verify(message.token);
    } catch {
      this.#fail(
        "UNAUTHENTICATED",
        "Autenticação necessária.",
        1008,
        "unauthenticated",
      );
      return;
    }
    if (this.#state === "closed") return;

    if (
      !this.#dependencies.requestRateLimiter.allow(
        `document-session:${principal.userId}`,
        DOCUMENT_RATE_LIMIT,
        RATE_WINDOW_MS,
      )
    ) {
      this.#fail(
        "RATE_LIMITED",
        "Limite temporário atingido. Aguarde um minuto.",
        1008,
        "rate_limited",
      );
      return;
    }

    let parsed;
    try {
      parsed = parsePublicationReference(
        this.#reference.cnjNumber,
        this.#reference.communicationNumber,
      );
      const resolved = await resolveAuthorizedPublication(
        principal,
        this.#reference.cnjNumber,
        this.#reference.communicationNumber,
        this.#dependencies.publicationLocator,
      );
      if (this.#isClosed()) return;
      this.#fileName = resolved.fileName;
      this.#peer.sendJson({ type: "status", status: "preparing" });
      this.#state = "connecting";
      const renderer = await this.#dependencies.rendererConnector.connect(
        {
          sourceUrl: resolved.reference.sourceUrl,
          cnjNumber: parsed.cnjNumber,
          communicationNumber: parsed.communicationNumber,
        },
        {
          onChallenge: (challenge) => this.#onChallenge(challenge),
          onDocument: (document) => this.#onDocument(document),
          onError: (code) => this.#onRendererError(code),
        },
      );
      if (this.#isClosed()) {
        renderer.close();
        return;
      }
      this.#renderer = renderer;
      if (this.#state === "connecting") this.#state = "awaiting_renderer";
    } catch (error) {
      if (
        error instanceof PublicationNotFoundError ||
        error instanceof PublicationReferenceInvalidError
      ) {
        this.#fail(
          "PUBLICATION_NOT_FOUND",
          "Publicação não encontrada.",
          1008,
          "publication_not_found",
        );
        return;
      }
      this.#fail(
        "SOURCE_UNAVAILABLE",
        rendererMessages.SOURCE_UNAVAILABLE,
        1011,
        "source_unavailable",
      );
    }
  }

  #onChallenge(challenge: {
    imageDataUrl: string;
    expiresAt: string;
    rejected?: boolean;
  }): void {
    if (this.#state === "closed") return;
    if (!validChallenge(challenge)) {
      this.#onRendererError("SOURCE_POLICY_REJECTED");
      return;
    }
    this.#state = "awaiting_answer";
    this.#peer.sendJson({
      type: "challenge",
      imageDataUrl: challenge.imageDataUrl,
      expiresAt: challenge.expiresAt,
      ...(challenge.rejected ? { rejected: true } : {}),
    });
  }

  #onDocument(document: AssistedRendererDocument): void {
    if (this.#state === "closed") return;
    if (!validDocument(document)) {
      this.#onRendererError("DOCUMENT_INTEGRITY_REJECTED");
      return;
    }
    this.#peer.sendJson({
      type: "document",
      fileName: this.#fileName,
      mediaType: "application/pdf",
      byteLength: document.bytes.byteLength,
      sha256: document.sha256,
    });
    this.#peer.sendBinary(document.bytes);
    this.#finish(1000, "complete");
  }

  #onRendererError(code: RendererErrorCode): void {
    if (this.#state === "closed") return;
    this.#fail(
      code,
      rendererMessages[code],
      code === "SESSION_EXPIRED" ? 1000 : 1011,
      code.toLowerCase(),
    );
  }

  #expire(): void {
    if (this.#state === "closed") return;
    this.#fail(
      "SESSION_EXPIRED",
      rendererMessages.SESSION_EXPIRED,
      1000,
      "session_expired",
    );
  }

  #invalidMessage(): void {
    this.#fail(
      "INVALID_SESSION_MESSAGE",
      "A sessão recebeu uma mensagem inválida.",
      1008,
      "invalid_message",
    );
  }

  #fail(
    code: string,
    message: string,
    closeCode: number,
    reason: string,
  ): void {
    if (this.#state === "closed") return;
    this.#peer.sendJson({ type: "error", code, message });
    this.#finish(closeCode, reason);
  }

  #finish(code: number, reason: string): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#cancelTimeout();
    this.#renderer?.close();
    this.#peer.close(code, reason);
  }

  #isClosed(): boolean {
    return this.#state === "closed";
  }
}
