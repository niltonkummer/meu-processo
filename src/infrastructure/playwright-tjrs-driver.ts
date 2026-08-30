import { createHash } from "node:crypto";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Download,
  type Page,
  type Response,
} from "playwright-core";

import type {
  BrowserChallengeDriver,
  BrowserChallengeDriverFactory,
  BrowserDriverStep,
} from "../application/browser-renderer-session.js";
import {
  isPublicIp,
  NodeHostResolver,
  type HostResolver,
} from "./secure-document-client.js";

const OUTCOME_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;
const CHALLENGE_TTL_MS = 2 * 60 * 1_000;
const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type BrowserPageOutcome =
  | { type: "challenge"; pngBytes: Uint8Array }
  | { type: "document"; bytes: Uint8Array };

export interface BrowserPagePort {
  open(sourceUrl: string): Promise<void>;
  readOutcome(): Promise<BrowserPageOutcome>;
  submit(answer: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserPagePortFactory {
  create(input: {
    allowedHosts: readonly string[];
    maxDocumentBytes: number;
  }): Promise<BrowserPagePort>;
}

const hasSignature = (bytes: Uint8Array, signature: Uint8Array): boolean =>
  signature.every((value, index) => bytes[index] === value);

const validPdf = (bytes: Uint8Array, maxBytes: number): boolean =>
  bytes.byteLength >= 5 &&
  bytes.byteLength <= maxBytes &&
  new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

const sourceAllowed = (sourceUrl: string, allowedHosts: readonly string[]) => {
  try {
    const url = new URL(sourceUrl);
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      url.username === "" &&
      url.password === "" &&
      allowedHosts.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
};

export class PlaywrightTjrsDriver implements BrowserChallengeDriver {
  readonly #pageFactory: BrowserPagePortFactory;
  #page?: BrowserPagePort;
  #maxDocumentBytes = 0;
  #maxChallengeBytes = 0;
  #closed = false;

  constructor(pageFactory: BrowserPagePortFactory) {
    this.#pageFactory = pageFactory;
  }

  async open(input: {
    sourceUrl: string;
    allowedHosts: readonly string[];
    maxDocumentBytes: number;
    maxChallengeBytes: number;
  }): Promise<BrowserDriverStep> {
    if (
      this.#page ||
      this.#closed ||
      !sourceAllowed(input.sourceUrl, input.allowedHosts)
    ) {
      throw new Error("source policy rejected");
    }
    this.#maxDocumentBytes = input.maxDocumentBytes;
    this.#maxChallengeBytes = input.maxChallengeBytes;
    const page = await this.#pageFactory.create({
      allowedHosts: input.allowedHosts,
      maxDocumentBytes: input.maxDocumentBytes,
    });
    this.#page = page;
    await page.open(input.sourceUrl);
    return this.#validate(await page.readOutcome());
  }

  async submit(answer: string): Promise<BrowserDriverStep> {
    if (!this.#page || this.#closed || !/^[A-Za-z0-9]{1,32}$/u.test(answer)) {
      throw new Error("invalid challenge answer");
    }
    await this.#page.submit(answer);
    return this.#validate(await this.#page.readOutcome());
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#page?.close();
  }

  #validate(outcome: BrowserPageOutcome): BrowserDriverStep {
    if (outcome.type === "document") {
      if (!validPdf(outcome.bytes, this.#maxDocumentBytes)) {
        throw new Error("document integrity rejected");
      }
      return { type: "document", bytes: outcome.bytes };
    }
    if (
      outcome.pngBytes.byteLength < PNG_SIGNATURE.byteLength ||
      outcome.pngBytes.byteLength > this.#maxChallengeBytes ||
      !hasSignature(outcome.pngBytes, PNG_SIGNATURE)
    ) {
      throw new Error("challenge integrity rejected");
    }
    return {
      type: "challenge",
      imageDataUrl: `data:image/png;base64,${Buffer.from(outcome.pngBytes).toString("base64")}`,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    };
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const challengeDiscoveryScript = `(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const fields = [...document.querySelectorAll('input:not([type]), input[type="text"], input[type="search"]')]
    .filter(visible);
  const candidates = [...document.querySelectorAll('img, canvas')]
    .filter(visible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const marker = [element.id, element.className, element.getAttribute('src'), element.getAttribute('alt')]
        .filter(Boolean).join(' ').toLowerCase();
      const nearestField = fields
        .map((field) => {
          const fieldRect = field.getBoundingClientRect();
          const distance = Math.abs(fieldRect.top - rect.bottom) + Math.abs(fieldRect.left - rect.left);
          const fieldMarker = [field.id, field.getAttribute('name'), field.getAttribute('placeholder')]
            .filter(Boolean).join(' ').toLowerCase();
          return { field, distance, fieldMarker };
        })
        .sort((left, right) => left.distance - right.distance)[0];
      const areaScore = rect.width >= 80 && rect.width <= 800 && rect.height >= 20 && rect.height <= 250 && rect.width / rect.height >= 1.4 ? 30 : -100;
      const markerScore = /captcha|infracaptcha|c[oó]digo/.test(marker) ? 80 : 0;
      const fieldScore = nearestField && /captcha|infracaptcha|c[oó]digo|seguran/.test(nearestField.fieldMarker) ? 60 : 0;
      const proximityScore = nearestField && nearestField.distance < 500 ? Math.max(0, 50 - nearestField.distance / 10) : -50;
      return { element, field: nearestField?.field, score: areaScore + markerScore + fieldScore + proximityScore };
    })
    .filter((candidate) => candidate.field && candidate.score > 20)
    .sort((left, right) => right.score - left.score);
  const selected = candidates[0];
  if (!selected) return false;
  document.querySelectorAll('[data-meu-processo-challenge]').forEach((element) => element.removeAttribute('data-meu-processo-challenge'));
  document.querySelectorAll('[data-meu-processo-answer]').forEach((element) => element.removeAttribute('data-meu-processo-answer'));
  selected.element.setAttribute('data-meu-processo-challenge', 'true');
  selected.field.setAttribute('data-meu-processo-answer', 'true');
  const form = selected.field.form;
  const submit = form?.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  if (submit) submit.setAttribute('data-meu-processo-submit', 'true');
  return true;
})()`;

class PlaywrightBrowserPage implements BrowserPagePort {
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #maxDocumentBytes: number;
  #pdf?: Uint8Array;
  #captureError?: Error;
  #lastChallengeHash?: string;
  #notBefore = 0;
  #closed = false;

  constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    maxDocumentBytes: number,
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#maxDocumentBytes = maxDocumentBytes;
    page.on("response", (response) => void this.#captureResponse(response));
    page.on("download", (download) => void this.#captureDownload(download));
  }

  async open(sourceUrl: string): Promise<void> {
    try {
      await this.#page.goto(sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: OUTCOME_TIMEOUT_MS,
      });
    } catch (error) {
      if (!this.#pdf && !this.#captureError) throw error;
    }
  }

  async readOutcome(): Promise<BrowserPageOutcome> {
    const deadline = Date.now() + OUTCOME_TIMEOUT_MS;
    while (!this.#closed && Date.now() < deadline) {
      if (this.#captureError) throw this.#captureError;
      if (this.#pdf) return { type: "document", bytes: this.#pdf };
      if (Date.now() >= this.#notBefore) {
        const challenge = await this.#captureChallenge();
        if (challenge) {
          const hash = createHash("sha256").update(challenge).digest("hex");
          if (!this.#lastChallengeHash || hash !== this.#lastChallengeHash || Date.now() >= this.#notBefore + 1_000) {
            this.#lastChallengeHash = hash;
            return { type: "challenge", pngBytes: challenge };
          }
        }
      }
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error("browser outcome timeout");
  }

  async submit(answer: string): Promise<void> {
    const answerField = this.#page.locator('[data-meu-processo-answer="true"]');
    await answerField.fill(answer, { timeout: 5_000 });
    this.#notBefore = Date.now() + 500;
    const markedSubmit = this.#page.locator('[data-meu-processo-submit="true"]');
    if ((await markedSubmit.count()) > 0) {
      await markedSubmit.first().click({ timeout: 5_000 });
      return;
    }
    await answerField.press("Enter", { timeout: 5_000 });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#context.close().catch(() => undefined);
    await this.#browser.close().catch(() => undefined);
  }

  async #captureChallenge(): Promise<Uint8Array | undefined> {
    const found = await this.#page.evaluate<boolean>(challengeDiscoveryScript);
    if (!found) return undefined;
    const bytes = await this.#page
      .locator('[data-meu-processo-challenge="true"]')
      .screenshot({ type: "png", animations: "disabled", timeout: 5_000 });
    return new Uint8Array(bytes);
  }

  async #captureResponse(response: Response): Promise<void> {
    const contentType = response.headers()["content-type"]?.toLowerCase() ?? "";
    if (!contentType.includes("application/pdf")) return;
    try {
      const body = await response.body();
      this.#acceptPdf(new Uint8Array(body));
    } catch {
      this.#captureError = new Error("unable to read PDF response");
    }
  }

  async #captureDownload(download: Download): Promise<void> {
    try {
      const stream = await download.createReadStream();
      if (!stream) throw new Error("download stream unavailable");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        const bytes = Uint8Array.from(chunk);
        total += bytes.byteLength;
        if (total > this.#maxDocumentBytes) throw new Error("PDF size limit");
        chunks.push(bytes);
      }
      this.#acceptPdf(new Uint8Array(Buffer.concat(chunks)));
    } catch {
      this.#captureError = new Error("unable to read PDF download");
    }
  }

  #acceptPdf(bytes: Uint8Array): void {
    if (!validPdf(bytes, this.#maxDocumentBytes)) {
      this.#captureError = new Error("document integrity rejected");
      return;
    }
    this.#pdf = bytes;
  }
}

export class PlaywrightBrowserPageFactory implements BrowserPagePortFactory {
  readonly #resolver: HostResolver;

  constructor(resolver: HostResolver = new NodeHostResolver()) {
    this.#resolver = resolver;
  }

  async create(input: {
    allowedHosts: readonly string[];
    maxDocumentBytes: number;
  }): Promise<BrowserPagePort> {
    const uniqueHosts = [...new Set(input.allowedHosts.map((host) => host.toLowerCase()))];
    if (uniqueHosts.length === 0) throw new Error("source policy rejected");
    const resolverRules: string[] = [];
    for (const host of uniqueHosts) {
      const addresses = await this.#resolver.resolve(host);
      if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
        throw new Error("DNS policy rejected");
      }
      const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
      if (!selected) throw new Error("DNS policy rejected");
      const address = selected.family === 6 ? `[${selected.address}]` : selected.address;
      resolverRules.push(`MAP ${host} ${address}`);
    }

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--no-sandbox",
        `--host-resolver-rules=${resolverRules.join(",")}`,
      ],
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      try {
        const url = new URL(route.request().url());
        if (["about:", "blob:", "data:"].includes(url.protocol)) {
          await route.continue();
          return;
        }
        if (
          url.protocol === "https:" &&
          (url.port === "" || url.port === "443") &&
          uniqueHosts.includes(url.hostname.toLowerCase())
        ) {
          await route.continue();
          return;
        }
      } catch {
        // Invalid browser requests are blocked below.
      }
      await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    return new PlaywrightBrowserPage(
      browser,
      context,
      page,
      input.maxDocumentBytes,
    );
  }
}

export class PlaywrightTjrsDriverFactory
  implements BrowserChallengeDriverFactory
{
  readonly #pageFactory: BrowserPagePortFactory;

  constructor(pageFactory: BrowserPagePortFactory = new PlaywrightBrowserPageFactory()) {
    this.#pageFactory = pageFactory;
  }

  create(): Promise<BrowserChallengeDriver> {
    return Promise.resolve(new PlaywrightTjrsDriver(this.#pageFactory));
  }
}
