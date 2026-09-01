import { describe, expect, it, vi } from "vitest";

import type { BrowserDriverStep } from "../application/browser-renderer-session.js";
import {
  challengeDiscoveryScript,
  PlaywrightBrowserPage,
  PlaywrightTjrsDriver,
  type BrowserPagePort,
  type BrowserPagePortFactory,
} from "./playwright-tjrs-driver.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const PDF = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
const SOURCE =
  "https://eproc1g.tjrs.jus.br/eproc/controlador.php?acao=acessar_documento_publico";

const rect = (
  width: number,
  height: number,
  top: number,
  left: number,
): DOMRect => ({
  x: left,
  y: top,
  width,
  height,
  top,
  right: left + width,
  bottom: top + height,
  left,
  toJSON: () => ({}),
});

const setup = (outcomes: BrowserDriverStep[]) => {
  const page: BrowserPagePort = {
    open: vi.fn(),
    readOutcome: vi.fn(() => {
      const next = outcomes.shift();
      if (!next) return Promise.reject(new Error("missing fixture outcome"));
      return Promise.resolve(
        next.type === "challenge"
          ? { type: "challenge" as const, pngBytes: PNG }
          : { type: "document" as const, bytes: next.bytes },
      );
    }),
    submit: vi.fn(),
    close: vi.fn(),
  };
  const factory: BrowserPagePortFactory = {
    create: vi.fn(() => Promise.resolve(page)),
  };
  return { page, factory, driver: new PlaywrightTjrsDriver(factory) };
};

describe("PlaywrightTjrsDriver", () => {
  it("starts inspection at navigation commit and observes beyond the old timeout", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const screenshot = vi.fn(() => Promise.resolve(Buffer.from(PNG)));
      const page = {
        on: vi.fn(),
        goto: vi.fn(() => Promise.resolve(null)),
        evaluate: vi.fn(() => Promise.resolve(Date.now() - startedAt >= 16_000)),
        locator: vi.fn(() => ({ screenshot })),
      };
      const browserPage = new PlaywrightBrowserPage(
        { close: vi.fn(() => Promise.resolve()) } as never,
        { close: vi.fn(() => Promise.resolve()) } as never,
        page as never,
        25 * 1024 * 1024,
      );

      await browserPage.open(SOURCE);
      const outcome = browserPage.readOutcome();
      await vi.advanceTimersByTimeAsync(16_000);

      await expect(outcome).resolves.toEqual({
        type: "challenge",
        pngBytes: PNG,
      });
      expect(page.goto).toHaveBeenCalledWith(SOURCE, {
        waitUntil: "commit",
        timeout: 45_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects the rendered CAPTCHA surface and ignores its marked audio control", () => {
    document.body.innerHTML = `
      <form>
        <img id="infraCaptchaAudio" alt="Ouvir código" src="data:image/png;base64,aA==">
        <div id="renderedChallenge" data-url="/captcha-render.png"></div>
        <input id="txtInfraCaptcha" name="captcha" type="text">
      </form>`;
    const audio = document.querySelector("#infraCaptchaAudio")!;
    const challenge = document.querySelector("#renderedChallenge")!;
    const field = document.querySelector("#txtInfraCaptcha")!;
    vi.spyOn(audio, "getBoundingClientRect").mockReturnValue(rect(24, 24, 0, 0));
    vi.spyOn(challenge, "getBoundingClientRect").mockReturnValue(rect(220, 70, 20, 20));
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue(rect(220, 44, 100, 20));

    expect(window.eval(challengeDiscoveryScript)).toBe(true);
    expect(challenge).toHaveAttribute("data-meu-processo-challenge", "true");
    expect(audio).not.toHaveAttribute("data-meu-processo-challenge");
    expect(field).toHaveAttribute("data-meu-processo-answer", "true");
  });

  it("accepts a non-empty canvas but rejects an audio-only or unloaded surface", () => {
    document.body.innerHTML = `
      <form>
        <canvas id="captchaCanvas" width="220" height="70"></canvas>
        <input name="codigoSeguranca" type="text">
      </form>`;
    const canvas = document.querySelector("canvas")!;
    const field = document.querySelector("input")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect(220, 70, 20, 20));
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue(rect(220, 44, 100, 20));
    expect(window.eval(challengeDiscoveryScript)).toBe(true);

    document.body.innerHTML = `
      <form>
        <img id="captchaAudio" alt="speaker" src="data:image/png;base64,aA==">
        <img id="captchaImage" alt="Código de segurança">
        <input name="captcha" type="text">
      </form>`;
    for (const element of document.querySelectorAll("img, input")) {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
        element.tagName === "INPUT" ? rect(220, 44, 100, 20) : rect(220, 70, 20, 20),
      );
    }
    expect(window.eval(challengeDiscoveryScript)).toBe(false);
  });
  it("opens the allowlisted page and returns a bounded PNG challenge", async () => {
    const context = setup([
      {
        type: "challenge",
        imageDataUrl: "unused",
        expiresAt: "unused",
      },
    ]);

    const result = await context.driver.open({
      sourceUrl: SOURCE,
      allowedHosts: ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"],
      maxDocumentBytes: 25 * 1024 * 1024,
      maxChallengeBytes: 512 * 1024,
    });

    expect(context.factory.create).toHaveBeenCalledWith({
      allowedHosts: ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"],
      maxDocumentBytes: 25 * 1024 * 1024,
    });
    expect(context.page.open).toHaveBeenCalledWith(SOURCE);
    expect(result).toMatchObject({
      type: "challenge",
      imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(Date.parse((result as { expiresAt: string }).expiresAt)).toBeGreaterThan(
      Date.now(),
    );
  });

  it("keeps the page context to submit the human answer and return the PDF", async () => {
    const context = setup([
      { type: "challenge", imageDataUrl: "unused", expiresAt: "unused" },
      { type: "document", bytes: PDF },
    ]);
    await context.driver.open({
      sourceUrl: SOURCE,
      allowedHosts: ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"],
      maxDocumentBytes: PDF.byteLength,
      maxChallengeBytes: PNG.byteLength,
    });

    await expect(context.driver.submit("A19b")).resolves.toEqual({
      type: "document",
      bytes: PDF,
    });
    expect(context.page.submit).toHaveBeenCalledWith("A19b");
    await context.driver.close();
    expect(context.page.close).toHaveBeenCalledOnce();
  });

  it.each([
    "http://eproc1g.tjrs.jus.br/document",
    "https://127.0.0.1/document",
    "https://evil.example/document",
  ])("rejects an unsafe source before launching Chromium: %s", async (sourceUrl) => {
    const context = setup([]);
    await expect(
      context.driver.open({
        sourceUrl,
        allowedHosts: ["eproc1g.tjrs.jus.br"],
        maxDocumentBytes: 10,
        maxChallengeBytes: 10,
      }),
    ).rejects.toThrow("source policy");
    expect(context.factory.create).not.toHaveBeenCalled();
  });

  it("rejects malformed challenge and document bytes and closes idempotently", async () => {
    const badChallenge = setup([
      { type: "challenge", imageDataUrl: "unused", expiresAt: "unused" },
    ]);
    badChallenge.page.readOutcome = vi.fn(() =>
      Promise.resolve({
        type: "challenge" as const,
        pngBytes: Uint8Array.from([1, 2, 3]),
      }),
    );
    await expect(
      badChallenge.driver.open({
        sourceUrl: SOURCE,
        allowedHosts: ["eproc1g.tjrs.jus.br"],
        maxDocumentBytes: 10,
        maxChallengeBytes: 10,
      }),
    ).rejects.toThrow("challenge integrity");

    const badPdf = setup([{ type: "document", bytes: Uint8Array.from([1, 2, 3]) }]);
    await expect(
      badPdf.driver.open({
        sourceUrl: SOURCE,
        allowedHosts: ["eproc1g.tjrs.jus.br"],
        maxDocumentBytes: 10,
        maxChallengeBytes: 10,
      }),
    ).rejects.toThrow("document integrity");
    await badPdf.driver.close();
    await badPdf.driver.close();
    expect(badPdf.page.close).toHaveBeenCalledOnce();
  });
});
