import { createHash } from "node:crypto";

const ALLOWED_HOSTS = ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"] as const;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_CHALLENGE_BYTES = 512 * 1024;
const SESSION_TIMEOUT_MS = 120_000;

export interface BrowserRendererPeer {
  sendJson(value: unknown): void;
  sendBinary(value: Uint8Array): void;
  close(code: number, reason: string): void;
}

export type BrowserDriverStep =
  | {
      type: "challenge";
      imageDataUrl: string;
      expiresAt: string;
    }
  | {
      type: "document";
      bytes: Uint8Array;
    };

export interface BrowserChallengeDriver {
  open(input: {
    sourceUrl: string;
    allowedHosts: readonly string[];
    maxDocumentBytes: number;
    maxChallengeBytes: number;
  }): Promise<BrowserDriverStep>;
  submit(answer: string): Promise<BrowserDriverStep>;
  close(): Promise<void>;
}

export interface BrowserChallengeDriverFactory {
  create(): Promise<BrowserChallengeDriver>;
}

interface BrowserSessionOptions {
  schedule(callback: () => void, delayMs: number): () => void;
}

type State = "awaiting_open" | "opening" | "awaiting_answer" | "closed";

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

const validSource = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      url.username === "" &&
      url.password === "" &&
      ALLOWED_HOSTS.includes(url.hostname.toLowerCase() as (typeof ALLOWED_HOSTS)[number])
    );
  } catch {
    return false;
  }
};

const validOpen = (
  message: Record<string, unknown> | undefined,
): message is {
  type: "open";
  sourceUrl: string;
  cnjNumber: string;
  communicationNumber: number;
} =>
  message?.type === "open" &&
  validSource(message.sourceUrl) &&
  typeof message.cnjNumber === "string" &&
  /^\d{20}$/.test(message.cnjNumber) &&
  typeof message.communicationNumber === "number" &&
  Number.isSafeInteger(message.communicationNumber) &&
  message.communicationNumber > 0;

const validAnswer = (message: Record<string, unknown>): message is {
  type: "answer";
  answer: string;
} =>
  message.type === "answer" &&
  typeof message.answer === "string" &&
  /^[A-Za-z0-9]{1,32}$/.test(message.answer);

const validChallenge = (step: BrowserDriverStep): boolean =>
  step.type === "challenge" &&
  step.imageDataUrl.length <= MAX_CHALLENGE_BYTES * 2 &&
  /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(step.imageDataUrl) &&
  !Number.isNaN(Date.parse(step.expiresAt));

const validPdf = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 5 &&
  bytes.byteLength <= MAX_DOCUMENT_BYTES &&
  new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

export class BrowserRendererSession {
  readonly #peer: BrowserRendererPeer;
  readonly #factory: BrowserChallengeDriverFactory;
  readonly #cancelTimeout: () => void;
  #state: State = "awaiting_open";
  #driver?: BrowserChallengeDriver;

  constructor(
    peer: BrowserRendererPeer,
    factory: BrowserChallengeDriverFactory,
    options: BrowserSessionOptions,
  ) {
    this.#peer = peer;
    this.#factory = factory;
    this.#cancelTimeout = options.schedule(
      () => this.#expire(),
      SESSION_TIMEOUT_MS,
    );
  }

  async receiveText(text: string): Promise<void> {
    if (this.#state === "closed") return;
    const message = parseObject(text);

    if (this.#state === "awaiting_open") {
      if (!validOpen(message)) {
        this.#fail("SOURCE_POLICY_REJECTED", 1008, "source_policy_rejected");
        return;
      }
      await this.#open(message);
      return;
    }

    if (this.#state === "awaiting_answer" && message && validAnswer(message)) {
      await this.#submit(message.answer);
      return;
    }

    this.#fail("INVALID_CHALLENGE_ANSWER", 1008, "invalid_challenge_answer");
  }

  close(): void {
    this.#finish(1000, "cancelled");
  }

  async #open(message: {
    sourceUrl: string;
  }): Promise<void> {
    this.#state = "opening";
    try {
      const driver = await this.#factory.create();
      if (this.#isClosed()) {
        void driver.close().catch(() => undefined);
        return;
      }
      this.#driver = driver;
      const step = await driver.open({
        sourceUrl: message.sourceUrl,
        allowedHosts: [...ALLOWED_HOSTS],
        maxDocumentBytes: MAX_DOCUMENT_BYTES,
        maxChallengeBytes: MAX_CHALLENGE_BYTES,
      });
      this.#handleStep(step, false);
    } catch {
      this.#fail("SOURCE_UNAVAILABLE", 1011, "source_unavailable");
    }
  }

  async #submit(answer: string): Promise<void> {
    this.#state = "opening";
    try {
      const step = await this.#driver!.submit(answer);
      this.#handleStep(step, true);
    } catch {
      this.#fail("SOURCE_UNAVAILABLE", 1011, "source_unavailable");
    }
  }

  #handleStep(step: BrowserDriverStep, rejected: boolean): void {
    if (this.#state === "closed") return;
    if (step.type === "challenge") {
      if (!validChallenge(step)) {
        this.#fail("SOURCE_POLICY_REJECTED", 1011, "source_policy_rejected");
        return;
      }
      this.#state = "awaiting_answer";
      this.#peer.sendJson({
        type: "challenge",
        imageDataUrl: step.imageDataUrl,
        expiresAt: step.expiresAt,
        ...(rejected ? { rejected: true } : {}),
      });
      return;
    }

    if (!validPdf(step.bytes)) {
      this.#fail(
        "DOCUMENT_INTEGRITY_REJECTED",
        1011,
        "document_integrity_rejected",
      );
      return;
    }

    const sha256 = createHash("sha256").update(step.bytes).digest("hex");
    this.#peer.sendJson({
      type: "document",
      mediaType: "application/pdf",
      byteLength: step.bytes.byteLength,
      sha256,
    });
    this.#peer.sendBinary(step.bytes);
    this.#finish(1000, "complete");
  }

  #expire(): void {
    if (this.#state === "closed") return;
    this.#fail("SESSION_EXPIRED", 1000, "session_expired");
  }

  #fail(code: string, closeCode: number, reason: string): void {
    if (this.#state === "closed") return;
    this.#peer.sendJson({ type: "error", code });
    this.#finish(closeCode, reason);
  }

  #finish(code: number, reason: string): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#cancelTimeout();
    if (this.#driver) void this.#driver.close().catch(() => undefined);
    this.#peer.close(code, reason);
  }

  #isClosed(): boolean {
    return this.#state === "closed";
  }
}
