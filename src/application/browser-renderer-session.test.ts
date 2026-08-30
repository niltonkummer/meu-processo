import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  BrowserRendererSession,
  type BrowserChallengeDriver,
  type BrowserChallengeDriverFactory,
  type BrowserDriverStep,
  type BrowserRendererPeer,
} from "./browser-renderer-session.js";

const SOURCE_URL =
  "https://eproc1g.tjrs.jus.br/eproc/controlador.php?acao=acessar_documento_publico";
const CHALLENGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const PDF = new TextEncoder().encode("%PDF-1.7\nrenderer\n%%EOF");
const SHA256 = createHash("sha256").update(PDF).digest("hex");

class Peer implements BrowserRendererPeer {
  readonly text: unknown[] = [];
  readonly binary: Uint8Array[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  sendJson(value: unknown) {
    this.text.push(value);
  }

  sendBinary(value: Uint8Array) {
    this.binary.push(value);
  }

  close(code: number, reason: string) {
    this.closes.push({ code, reason });
  }
}

class Driver implements BrowserChallengeDriver {
  open = vi.fn<BrowserChallengeDriver["open"]>(() => Promise.resolve({
    type: "challenge" as const,
    imageDataUrl: CHALLENGE,
    expiresAt: "2026-08-30T12:02:00.000Z",
  }));
  submit = vi.fn<(answer: string) => Promise<BrowserDriverStep>>(() => Promise.resolve({
    type: "document" as const,
    bytes: PDF,
  }));
  close = vi.fn(() => Promise.resolve());
}

const createSession = ({
  driver = new Driver(),
  schedule = vi.fn(() => vi.fn()),
}: {
  driver?: Driver;
  schedule?: (callback: () => void, delayMs: number) => () => void;
} = {}) => {
  const peer = new Peer();
  const factory = {
    create: vi.fn(() => Promise.resolve(driver)),
  } satisfies BrowserChallengeDriverFactory;
  return {
    session: new BrowserRendererSession(peer, factory, { schedule }),
    peer,
    driver,
    factory,
    schedule,
  };
};

const openMessage = JSON.stringify({
  type: "open",
  sourceUrl: SOURCE_URL,
  cnjNumber: "50157906020268210003",
  communicationNumber: 37884,
});

describe("BrowserRendererSession", () => {
  it("opens one allowlisted source and returns only the bounded challenge", async () => {
    const { session, peer, driver, factory, schedule } = createSession();

    await session.receiveText(openMessage);

    expect(factory.create).toHaveBeenCalledOnce();
    expect(driver.open).toHaveBeenCalledWith({
      sourceUrl: SOURCE_URL,
      allowedHosts: ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"],
      maxDocumentBytes: 25 * 1024 * 1024,
      maxChallengeBytes: 512 * 1024,
    });
    expect(peer.text).toEqual([
      {
        type: "challenge",
        imageDataUrl: CHALLENGE,
        expiresAt: "2026-08-30T12:02:00.000Z",
      },
    ]);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 120_000);
  });

  it.each([
    ["not-json"],
    ["null"],
    ["1"],
    [JSON.stringify({ type: "answer", answer: "123" })],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: "http://eproc1g.tjrs.jus.br/document",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: 42,
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: "not-a-url",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: `https://eproc1g.tjrs.jus.br/${"x".repeat(4_100)}`,
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: "https://user@eproc1g.tjrs.jus.br/document",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: "https://eproc1g.tjrs.jus.br:444/document",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: "https://evil.example/document",
        cnjNumber: "50157906020268210003",
        communicationNumber: 37884,
      }),
    ],
    [
      JSON.stringify({
        type: "open",
        sourceUrl: SOURCE_URL,
        cnjNumber: "invalid",
        communicationNumber: 37884,
      }),
    ],
  ])("rejects invalid open frame %j before creating a browser", async (frame) => {
    const { session, peer, factory } = createSession();

    await session.receiveText(frame);

    expect(peer.text).toEqual([
      {
        type: "error",
        code: "SOURCE_POLICY_REJECTED",
      },
    ]);
    expect(peer.closes).toEqual([
      { code: 1008, reason: "source_policy_rejected" },
    ]);
    expect(factory.create).not.toHaveBeenCalled();
  });

  it("submits one valid answer and emits metadata followed by PDF bytes", async () => {
    const { session, peer, driver } = createSession();
    await session.receiveText(openMessage);

    await session.receiveText(
      JSON.stringify({ type: "answer", answer: "A1B2C3" }),
    );

    expect(driver.submit).toHaveBeenCalledWith("A1B2C3");
    expect(peer.text.at(-1)).toEqual({
      type: "document",
      mediaType: "application/pdf",
      byteLength: PDF.byteLength,
      sha256: SHA256,
    });
    expect(peer.binary).toEqual([PDF]);
    expect(peer.closes).toEqual([{ code: 1000, reason: "complete" }]);
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it("keeps the same driver when the tribunal returns a replacement challenge", async () => {
    const driver = new Driver();
    driver.submit.mockResolvedValueOnce({
      type: "challenge",
      imageDataUrl: `${CHALLENGE}AA==`,
      expiresAt: "2026-08-30T12:03:00.000Z",
    });
    const { session, peer, factory } = createSession({ driver });
    await session.receiveText(openMessage);

    await session.receiveText(
      JSON.stringify({ type: "answer", answer: "WRONG1" }),
    );

    expect(factory.create).toHaveBeenCalledOnce();
    expect(peer.text.at(-1)).toEqual({
      type: "challenge",
      imageDataUrl: `${CHALLENGE}AA==`,
      expiresAt: "2026-08-30T12:03:00.000Z",
      rejected: true,
    });
    expect(driver.close).not.toHaveBeenCalled();
  });

  it.each([
    [""],
    ["with space"],
    ["x".repeat(33)],
    ["áé"],
  ])("rejects invalid answer %j without calling the page", async (answer) => {
    const { session, peer, driver } = createSession();
    await session.receiveText(openMessage);

    await session.receiveText(JSON.stringify({ type: "answer", answer }));

    expect(driver.submit).not.toHaveBeenCalled();
    expect(peer.text.at(-1)).toEqual({
      type: "error",
      code: "INVALID_CHALLENGE_ANSWER",
    });
    expect(peer.closes).toEqual([
      { code: 1008, reason: "invalid_challenge_answer" },
    ]);
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it.each([
    [new TextEncoder().encode("not-pdf")],
    [new Uint8Array(25 * 1024 * 1024 + 1)],
  ])("rejects invalid document bytes from the page", async (bytes) => {
    const driver = new Driver();
    driver.submit.mockResolvedValueOnce({ type: "document", bytes });
    const { session, peer } = createSession({ driver });
    await session.receiveText(openMessage);

    await session.receiveText(
      JSON.stringify({ type: "answer", answer: "A1B2C3" }),
    );

    expect(peer.binary).toEqual([]);
    expect(peer.text.at(-1)).toEqual({
      type: "error",
      code: "DOCUMENT_INTEGRITY_REJECTED",
    });
    expect(peer.closes).toEqual([
      { code: 1011, reason: "document_integrity_rejected" },
    ]);
  });

  it("maps driver errors categorically and cleans up", async () => {
    const driver = new Driver();
    driver.open.mockRejectedValueOnce(new Error("sensitive upstream details"));
    const { session, peer } = createSession({ driver });

    await session.receiveText(openMessage);

    expect(peer.text).toEqual([{ type: "error", code: "SOURCE_UNAVAILABLE" }]);
    expect(peer.closes).toEqual([
      { code: 1011, reason: "source_unavailable" },
    ]);
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it("maps submit failures and malformed replacement challenges", async () => {
    const submitFailure = new Driver();
    submitFailure.submit.mockRejectedValueOnce(new Error("page details"));
    const failed = createSession({ driver: submitFailure });
    await failed.session.receiveText(openMessage);
    await failed.session.receiveText(
      JSON.stringify({ type: "answer", answer: "A19b" }),
    );
    expect(failed.peer.text.at(-1)).toEqual({
      type: "error",
      code: "SOURCE_UNAVAILABLE",
    });

    const malformed = new Driver();
    malformed.submit.mockResolvedValueOnce({
      type: "challenge",
      imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      expiresAt: "invalid",
    });
    const rejected = createSession({ driver: malformed });
    await rejected.session.receiveText(openMessage);
    await rejected.session.receiveText(
      JSON.stringify({ type: "answer", answer: "A19b" }),
    );
    expect(rejected.peer.text.at(-1)).toEqual({
      type: "error",
      code: "SOURCE_POLICY_REJECTED",
    });
  });

  it("closes a driver that appears after cancellation and ignores its rejection", async () => {
    let resolveDriver!: (driver: BrowserChallengeDriver) => void;
    const driver = new Driver();
    driver.close.mockRejectedValueOnce(new Error("close details"));
    const factory: BrowserChallengeDriverFactory = {
      create: vi.fn(
        () =>
          new Promise<BrowserChallengeDriver>((resolve) => {
            resolveDriver = resolve;
          }),
      ),
    };
    const peer = new Peer();
    const session = new BrowserRendererSession(peer, factory, {
      schedule: vi.fn(() => vi.fn()),
    });
    const opening = session.receiveText(openMessage);
    session.close();
    resolveDriver(driver);
    await opening;
    await Promise.resolve();
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it("ignores a late submit result and a timeout after completion", async () => {
    const driver = new Driver();
    let resolveSubmit!: (step: BrowserDriverStep) => void;
    driver.submit.mockImplementationOnce(
      () =>
        new Promise<BrowserDriverStep>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    let expire: () => void = () => undefined;
    const context = createSession({
      driver,
      schedule: vi.fn((callback: () => void) => {
        expire = callback;
        return vi.fn();
      }),
    });
    await context.session.receiveText(openMessage);
    const submitting = context.session.receiveText(
      JSON.stringify({ type: "answer", answer: "A19b" }),
    );
    context.session.close();
    resolveSubmit({ type: "document", bytes: PDF });
    await submitting;
    expire();
    expect(context.peer.binary).toEqual([]);
  });

  it("ignores a late submit rejection after close", async () => {
    const driver = new Driver();
    let rejectSubmit!: (reason: Error) => void;
    driver.submit.mockImplementationOnce(
      () =>
        new Promise<BrowserDriverStep>((_resolve, reject) => {
          rejectSubmit = reject;
        }),
    );
    const context = createSession({ driver });
    await context.session.receiveText(openMessage);
    const submitting = context.session.receiveText(
      JSON.stringify({ type: "answer", answer: "A19b" }),
    );
    context.session.close();
    rejectSubmit(new Error("late details"));
    await submitting;
    expect(context.peer.text).toHaveLength(1);
  });

  it("swallows driver cleanup errors", async () => {
    const driver = new Driver();
    driver.close.mockRejectedValueOnce(new Error("cleanup details"));
    const context = createSession({ driver });
    await context.session.receiveText(openMessage);
    context.session.close();
    await Promise.resolve();
    expect(context.peer.closes).toEqual([{ code: 1000, reason: "cancelled" }]);
  });

  it("expires and closes the driver exactly once", async () => {
    let expire: () => void = () => undefined;
    const schedule = vi.fn((callback: () => void) => {
      expire = callback;
      return vi.fn();
    });
    const { session, peer, driver } = createSession({ schedule });
    await session.receiveText(openMessage);

    expire();
    session.close();
    await session.receiveText(
      JSON.stringify({ type: "answer", answer: "LATE1" }),
    );

    expect(peer.text.at(-1)).toEqual({ type: "error", code: "SESSION_EXPIRED" });
    expect(peer.closes).toEqual([{ code: 1000, reason: "session_expired" }]);
    expect(driver.close).toHaveBeenCalledOnce();
    expect(driver.submit).not.toHaveBeenCalled();
  });
});
