import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { decodeHTMLAttribute } from "entities";

import type {
  DocumentClient,
  DocumentChallengeAnswer,
  DocumentReference,
  DownloadedDocument,
} from "../application/document-gateway.js";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_FORM_BYTES = 32 * 1024;
const MAX_FORM_FIELDS = 20;
const MAX_COOKIE_BYTES = 8 * 1024;
const MAX_CHALLENGE_IMAGE_BYTES = 512 * 1024;
const MAX_ACTIVE_CHALLENGES = 100;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export interface ResolvedHostAddress {
  address: string;
  family: 4 | 6;
}

export interface HostResolver {
  resolve(hostname: string): Promise<readonly ResolvedHostAddress[]>;
}

export interface DocumentTransportResponse {
  statusCode: number;
  headers: Readonly<Record<string, string | undefined>>;
  setCookies?: readonly string[];
  bytes: Uint8Array;
}

export interface DocumentRequestLimits {
  maxBytes: number;
  timeoutMs: number;
  cookie?: string;
}

export interface DocumentTransport {
  get(
    url: URL,
    address: ResolvedHostAddress,
    limits: DocumentRequestLimits,
  ): Promise<DocumentTransportResponse>;
  postForm?(
    url: URL,
    address: ResolvedHostAddress,
    body: string,
    limits: DocumentRequestLimits,
  ): Promise<DocumentTransportResponse>;
}

export interface DocumentRejectionSafeContext {
  readonly rejectionStage?:
    | "form_count"
    | "form_method_or_action"
    | "form_action_policy"
    | "form_input_type"
    | "form_empty_text"
    | "form_field_policy"
    | "form_body_policy";
  readonly rejectedInputType?:
    | "missing"
    | "text"
    | "password"
    | "file"
    | "checkbox"
    | "radio"
    | "email"
    | "number"
    | "search"
    | "tel"
    | "url"
    | "date"
    | "other";
  readonly documentImplementationHintCount?: number;
  readonly printDocumentHintCount?: number;
  readonly ajaxHintCount?: number;
  readonly humanChallengeTextHintCount?: number;
  readonly challengeFieldHintCount?: number;
  readonly captchaImageHintCount?: number;
  readonly captchaImageCandidateCount?: number;
  readonly captchaImageMissingSourceCount?: number;
  readonly captchaImageDataSourceCount?: number;
  readonly captchaImageSameHostHttpsCount?: number;
  readonly captchaImageAllowedCrossHostHttpsCount?: number;
  readonly captchaImageRejectedSourceCount?: number;
  readonly captchaStaticSameHostUrlCount?: number;
  readonly challengeResourceStatusCode?: number;
  readonly challengeResourceMediaCategory?:
    | "image"
    | "audio"
    | "html"
    | "other"
    | "missing";
  readonly challengeResourceMagicCategory?:
    | "png"
    | "jpeg"
    | "gif"
    | "audio"
    | "html"
    | "pdf"
    | "other";
  readonly challengeResourceByteLength?: number;
  readonly challengeResourceWidth?: number;
  readonly challengeResourceHeight?: number;
  readonly formCount: number;
  readonly postFormCount: number;
  readonly hiddenInputCount: number;
  readonly scriptCount: number;
  readonly anchorCount: number;
  readonly iframeCount: number;
  readonly embedCount: number;
  readonly objectCount: number;
  readonly metaRefreshCount: number;
  readonly sameHostFormActionCount: number;
  readonly setsCookie: boolean;
}

export class DocumentSourceRejectedError extends Error {
  constructor(
    readonly reason:
      | "policy"
      | "size_limit"
      | "redirect_policy"
      | "media_type"
      | "media_type_html"
      | "media_type_other"
      | "html_wrapper_policy"
      | "document_validation"
      | "url_policy"
      | "dns_policy" = "policy",
    readonly safeContext?: DocumentRejectionSafeContext,
  ) {
    super("A origem do documento foi rejeitada pela política de segurança.");
    this.name = "DocumentSourceRejectedError";
  }
}

export class DocumentSourceUnavailableError extends Error {
  constructor() {
    super("A origem do documento não está disponível.");
    this.name = "DocumentSourceUnavailableError";
  }
}

export class DocumentIntegrityError extends Error {
  constructor() {
    super("O documento recebido não corresponde à referência esperada.");
    this.name = "DocumentIntegrityError";
  }
}

export class DocumentChallengeRequiredError extends Error {
  constructor(
    readonly challengeId: string,
    readonly imageDataUrl: string,
    readonly expiresAt: string,
  ) {
    super("A origem exige um código visual informado pelo usuário.");
    this.name = "DocumentChallengeRequiredError";
  }
}

export class DocumentChallengeExpiredError extends Error {
  constructor() {
    super("O desafio expirou ou não pertence a esta publicação.");
    this.name = "DocumentChallengeExpiredError";
  }
}

export class DocumentChallengeAnswerInvalidError extends Error {
  constructor() {
    super("O código de segurança informado é inválido.");
    this.name = "DocumentChallengeAnswerInvalidError";
  }
}

class ChallengeResourceRejectedError extends Error {
  constructor(readonly safeContext: Partial<DocumentRejectionSafeContext>) {
    super("The challenge resource is not a supported visual raster.");
    this.name = "ChallengeResourceRejectedError";
  }
}

const isPublicIpv4 = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  const [first = 0, second = 0, third = 0] = octets;

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
};

const isPublicIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPublicIpv4(normalized.slice("::ffff:".length));
  }

  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
};

export const isPublicIp = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
};

export class NodeHostResolver implements HostResolver {
  async resolve(hostname: string): Promise<readonly ResolvedHostAddress[]> {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap((address) =>
      address.family === 4 || address.family === 6
        ? [{ address: address.address, family: address.family }]
        : [],
    );
  }
}

const flattenHeaders = (
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<Record<string, string | undefined>> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

export class NodeHttpsDocumentTransport implements DocumentTransport {
  get(
    url: URL,
    address: ResolvedHostAddress,
    limits: DocumentRequestLimits,
  ): Promise<DocumentTransportResponse> {
    return this.#send(url, address, "GET", undefined, limits);
  }

  postForm(
    url: URL,
    address: ResolvedHostAddress,
    body: string,
    limits: DocumentRequestLimits,
  ): Promise<DocumentTransportResponse> {
    return this.#send(url, address, "POST", body, limits);
  }

  #send(
    url: URL,
    address: ResolvedHostAddress,
    method: "GET" | "POST",
    body: string | undefined,
    limits: DocumentRequestLimits,
  ): Promise<DocumentTransportResponse> {
    return new Promise((resolve, reject) => {
      const bodyBytes = body === undefined ? undefined : Buffer.from(body, "utf-8");
      const outgoing = request(
        {
          protocol: "https:",
          hostname: address.address,
          port: 443,
          servername: url.hostname,
          method,
          path: `${url.pathname}${url.search}`,
          headers: {
            accept:
              "application/pdf,image/png,image/jpeg,image/gif,application/octet-stream;q=0.9,text/html;q=0.8",
            host: url.hostname,
            "user-agent": "MeuProcesso-DocumentGateway/1.0",
            ...(limits.cookie ? { cookie: limits.cookie } : {}),
            ...(bodyBytes
              ? {
                  "content-type": "application/x-www-form-urlencoded",
                  "content-length": String(bodyBytes.byteLength),
                }
              : {}),
          },
        },
        (incoming) => {
          const chunks: Uint8Array[] = [];
          let receivedBytes = 0;
          incoming.on("data", (chunk: Uint8Array) => {
            receivedBytes += chunk.byteLength;
            if (receivedBytes > limits.maxBytes) {
              incoming.destroy(new DocumentSourceRejectedError("size_limit"));
              return;
            }
            chunks.push(chunk);
          });
          incoming.on("end", () => {
            resolve({
              statusCode: incoming.statusCode ?? 0,
              headers: flattenHeaders(incoming.headers),
              ...(incoming.headers["set-cookie"]
                ? { setCookies: incoming.headers["set-cookie"] }
                : {}),
              bytes: Buffer.concat(chunks),
            });
          });
          incoming.on("error", reject);
        },
      );

      const timeout = setTimeout(() => {
        outgoing.destroy(new DocumentSourceUnavailableError());
      }, limits.timeoutMs);
      outgoing.on("close", () => clearTimeout(timeout));
      outgoing.on("error", reject);
      outgoing.end(bodyBytes);
    });
  }
}

type OriginCookieJar = Map<string, Map<string, string>>;

interface HiddenPostForm {
  readonly url: string;
  readonly body: string;
  readonly safeContext: DocumentRejectionSafeContext;
}

interface ChallengeImage {
  readonly bytes: Uint8Array;
  readonly mediaType: "image/png" | "image/jpeg" | "image/gif";
}

type ChallengeImageSource =
  | { readonly kind: "inline"; readonly image: ChallengeImage }
  | { readonly kind: "remote"; readonly url: string };

interface HiddenPostChallenge {
  readonly url: string;
  readonly body: string;
  readonly challengeFieldName: string;
  readonly imageSource: ChallengeImageSource;
  readonly safeContext: DocumentRejectionSafeContext;
}

interface StoredDocumentChallenge extends HiddenPostChallenge {
  readonly reference: DocumentReference;
  readonly cookies: OriginCookieJar;
  readonly redirectCount: number;
  readonly expiresAtMs: number;
}

export class SecureDocumentClient implements DocumentClient {
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #resolver: HostResolver;
  readonly #transport: DocumentTransport;
  readonly #maxBytes: number;
  readonly #timeoutMs: number;
  readonly #maxRedirects: number;
  readonly #maxConcurrentDownloads: number;
  readonly #now: () => number;
  readonly #challenges = new Map<string, StoredDocumentChallenge>();
  #activeDownloads = 0;

  constructor({
    allowedHosts,
    resolver = new NodeHostResolver(),
    transport = new NodeHttpsDocumentTransport(),
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    maxConcurrentDownloads = 2,
    now = Date.now,
  }: {
    allowedHosts: readonly string[];
    resolver?: HostResolver;
    transport?: DocumentTransport;
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
    maxConcurrentDownloads?: number;
    now?: () => number;
  }) {
    this.#allowedHosts = new Set(
      allowedHosts.map((hostname) => hostname.toLowerCase()),
    );
    this.#resolver = resolver;
    this.#transport = transport;
    this.#maxBytes = maxBytes;
    this.#timeoutMs = timeoutMs;
    this.#maxRedirects = maxRedirects;
    this.#maxConcurrentDownloads = maxConcurrentDownloads;
    this.#now = now;
  }

  async download(reference: DocumentReference): Promise<DownloadedDocument> {
    if (this.#activeDownloads >= this.#maxConcurrentDownloads) {
      throw new DocumentSourceUnavailableError();
    }

    this.#activeDownloads += 1;
    try {
      return await this.#downloadFrom(
        reference,
        reference.sourceUrl,
        0,
        this.#now() + this.#timeoutMs,
        new Map(),
      );
    } finally {
      this.#activeDownloads -= 1;
    }
  }

  async completeChallenge(
    reference: DocumentReference,
    challenge: DocumentChallengeAnswer,
  ): Promise<DownloadedDocument> {
    if (!/^[A-Za-z0-9]{1,32}$/u.test(challenge.answer)) {
      throw new DocumentChallengeAnswerInvalidError();
    }
    this.#pruneChallenges();
    const stored = this.#challenges.get(challenge.challengeId);
    this.#challenges.delete(challenge.challengeId);
    if (
      !stored ||
      stored.expiresAtMs <= this.#now() ||
      !this.#sameReference(stored.reference, reference)
    ) {
      throw new DocumentChallengeExpiredError();
    }

    const parameters = new URLSearchParams(stored.body);
    parameters.append(stored.challengeFieldName, challenge.answer);
    const body = parameters.toString();
    if (Buffer.byteLength(body, "utf-8") > MAX_FORM_BYTES) {
      throw new DocumentSourceRejectedError("html_wrapper_policy");
    }
    if (this.#activeDownloads >= this.#maxConcurrentDownloads) {
      throw new DocumentSourceUnavailableError();
    }
    this.#activeDownloads += 1;
    try {
      return await this.#postFormFrom(
        reference,
        { url: stored.url, body, safeContext: stored.safeContext },
        stored.redirectCount,
        this.#now() + this.#timeoutMs,
        stored.cookies,
      );
    } finally {
      this.#activeDownloads -= 1;
    }
  }

  async #downloadFrom(
    reference: DocumentReference,
    sourceUrl: string,
    redirectCount: number,
    deadline: number,
    cookies: OriginCookieJar,
  ): Promise<DownloadedDocument> {
    const url = this.#validateUrl(sourceUrl);
    const addresses = await this.#resolvePublicAddresses(url.hostname);
    let response: DocumentTransportResponse;
    const remainingTimeMs = deadline - this.#now();
    if (remainingTimeMs <= 0) throw new DocumentSourceUnavailableError();
    try {
      response = await this.#transport.get(
        url,
        addresses[0]!,
        this.#requestLimits(url, remainingTimeMs, cookies),
      );
    } catch (error) {
      if (error instanceof DocumentSourceRejectedError) throw error;
      throw new DocumentSourceUnavailableError();
    }

    this.#captureOriginCookies(url, response.setCookies ?? [], cookies);
    return this.#handleResponse(
      reference,
      url,
      response,
      redirectCount,
      deadline,
      cookies,
    );
  }

  async #postFormFrom(
    reference: DocumentReference,
    form: HiddenPostForm,
    redirectCount: number,
    deadline: number,
    cookies: OriginCookieJar,
  ): Promise<DownloadedDocument> {
    if (!this.#transport.postForm) {
      throw new DocumentSourceRejectedError(
        "html_wrapper_policy",
        form.safeContext,
      );
    }
    const url = this.#validateUrl(form.url);
    const addresses = await this.#resolvePublicAddresses(url.hostname);
    const remainingTimeMs = deadline - this.#now();
    if (remainingTimeMs <= 0) throw new DocumentSourceUnavailableError();
    let response: DocumentTransportResponse;
    try {
      response = await this.#transport.postForm(
        url,
        addresses[0]!,
        form.body,
        this.#requestLimits(url, remainingTimeMs, cookies),
      );
    } catch (error) {
      if (error instanceof DocumentSourceRejectedError) throw error;
      throw new DocumentSourceUnavailableError();
    }
    this.#captureOriginCookies(url, response.setCookies ?? [], cookies);
    return this.#handleResponse(
      reference,
      url,
      response,
      redirectCount,
      deadline,
      cookies,
    );
  }

  async #handleResponse(
    reference: DocumentReference,
    url: URL,
    response: DocumentTransportResponse,
    redirectCount: number,
    deadline: number,
    cookies: OriginCookieJar,
  ): Promise<DownloadedDocument> {

    if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
      const location = response.headers.location;
      if (!location || redirectCount >= this.#maxRedirects) {
        throw new DocumentSourceRejectedError("redirect_policy");
      }
      return this.#downloadFrom(
        reference,
        new URL(location, url).toString(),
        redirectCount + 1,
        deadline,
        cookies,
      );
    }
    if (response.statusCode !== 200) throw new DocumentSourceUnavailableError();

    const mediaType = response.headers["content-type"]
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const hasPdfSignature = Buffer.from(response.bytes.subarray(0, 5)).equals(
      Buffer.from("%PDF-"),
    );
    if (mediaType === "text/html") {
      if (redirectCount >= this.#maxRedirects) {
        throw new DocumentSourceRejectedError("html_wrapper_policy");
      }
      const staticDocumentUrl = this.#resolveStaticHtmlDocument(url, response.bytes);
      if (staticDocumentUrl) {
        return this.#downloadFrom(
          reference,
          staticDocumentUrl,
          redirectCount + 1,
          deadline,
          cookies,
        );
      }
      const form = this.#resolveHiddenPostForm(
        url,
        response.bytes,
        response.headers,
      );
      if ("challengeFieldName" in form) {
        return this.#issueChallenge(
          reference,
          form,
          redirectCount + 1,
          deadline,
          cookies,
        );
      }
      return this.#postFormFrom(
        reference,
        form,
        redirectCount + 1,
        deadline,
        cookies,
      );
    }
    if (
      mediaType !== "application/pdf" &&
      !(mediaType === "application/octet-stream" && hasPdfSignature)
    ) {
      throw new DocumentSourceRejectedError(
        "media_type_other",
      );
    }

    const declaredLength = response.headers["content-length"];
    if (
      (declaredLength !== undefined &&
        (!/^\d+$/.test(declaredLength) || Number(declaredLength) > this.#maxBytes)) ||
      response.bytes.byteLength > this.#maxBytes ||
      !hasPdfSignature
    ) {
      throw new DocumentSourceRejectedError("document_validation");
    }

    const sha256 = createHash("sha256").update(response.bytes).digest("hex");
    if (
      reference.expectedSha256 !== undefined &&
      reference.expectedSha256.toLowerCase() !== sha256
    ) {
      throw new DocumentIntegrityError();
    }

    return { bytes: response.bytes, mediaType: "application/pdf", sha256 };
  }

  #validateUrl(sourceUrl: string): URL {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new DocumentSourceRejectedError("url_policy");
    }
    if (
      url.protocol !== "https:" ||
      (url.port !== "" && url.port !== "443") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      !this.#allowedHosts.has(url.hostname.toLowerCase())
    ) {
      throw new DocumentSourceRejectedError("url_policy");
    }
    return url;
  }

  #resolveStaticHtmlDocument(
    pageUrl: URL,
    bytes: Uint8Array,
  ): string | undefined {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const attributePatterns = [
      {
        pattern: /<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/giu,
        requiresDocumentHint: false,
      },
      {
        pattern: /<embed\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/giu,
        requiresDocumentHint: false,
      },
      {
        pattern: /<object\b[^>]*\bdata\s*=\s*(["'])(.*?)\1/giu,
        requiresDocumentHint: false,
      },
      {
        pattern: /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/giu,
        requiresDocumentHint: true,
      },
    ];
    const candidates = new Set<string>();
    for (const { pattern, requiresDocumentHint } of attributePatterns) {
      for (const match of html.matchAll(pattern)) {
        const encodedCandidate = match[2];
        if (!encodedCandidate) continue;
        const decodedCandidate = decodeHTMLAttribute(encodedCandidate);
        if (
          requiresDocumentHint &&
          !/(?:\.pdf(?:$|[?#])|download|documento|arquivo)/iu.test(
            decodedCandidate,
          )
        ) {
          continue;
        }
        try {
          const candidate = this.#validateUrl(
            new URL(decodedCandidate, pageUrl).toString(),
          );
          if (candidate.toString() !== pageUrl.toString()) {
            candidates.add(candidate.toString());
          }
        } catch {
          // Ignore unsafe candidates and fail closed unless one exact target remains.
        }
      }
    }
    return candidates.size === 1 ? [...candidates][0]! : undefined;
  }

  #resolveHiddenPostForm(
    pageUrl: URL,
    bytes: Uint8Array,
    headers: Readonly<Record<string, string | undefined>>,
  ): HiddenPostForm | HiddenPostChallenge {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const safeContext = this.#htmlSafeContext(pageUrl, html, headers);
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/giu)];
    if (forms.length !== 1) {
      throw new DocumentSourceRejectedError("html_wrapper_policy", {
        ...safeContext,
        rejectionStage: "form_count",
      });
    }
    const [, formAttributes = "", formBody = ""] = forms[0]!;
    const method = this.#htmlAttribute(formAttributes, "method")?.toLowerCase();
    const actionValue = this.#htmlAttribute(formAttributes, "action");
    if (method !== "post" || !actionValue) {
      throw new DocumentSourceRejectedError("html_wrapper_policy", {
        ...safeContext,
        rejectionStage: "form_method_or_action",
      });
    }

    let action: URL;
    try {
      action = this.#validateUrl(new URL(actionValue, pageUrl).toString());
    } catch {
      throw new DocumentSourceRejectedError("html_wrapper_policy", {
        ...safeContext,
        rejectionStage: "form_action_policy",
      });
    }
    if (action.hostname.toLowerCase() !== pageUrl.hostname.toLowerCase()) {
      throw new DocumentSourceRejectedError("html_wrapper_policy", {
        ...safeContext,
        rejectionStage: "form_action_policy",
      });
    }

    const parameters = new URLSearchParams();
    const inputs = [...formBody.matchAll(/<input\b([^>]*)>/giu)];
    let namedSubmitCount = 0;
    let challengeFieldName: string | undefined;
    let challengeFieldOffset: number | undefined;
    for (const inputMatch of inputs) {
      const inputAttributes = inputMatch[1] ?? "";
      const declaredType = this.#htmlAttribute(inputAttributes, "type");
      const type = (declaredType ?? "text").toLowerCase();
      if (type === "submit") {
        const name = this.#htmlAttribute(inputAttributes, "name");
        if (!name) continue;
        const value = this.#htmlAttribute(inputAttributes, "value") ?? "";
        namedSubmitCount += 1;
        if (
          namedSubmitCount > 1 ||
          name.length > 128 ||
          value.length > 8_192 ||
          parameters.size >= MAX_FORM_FIELDS
        ) {
          throw new DocumentSourceRejectedError("html_wrapper_policy", {
            ...safeContext,
            rejectionStage: "form_field_policy",
          });
        }
        parameters.append(name, value);
        continue;
      }
      if (
        type === "button" ||
        type === "image" ||
        type === "reset"
      ) {
        continue;
      }
      if (type !== "hidden" && type !== "text") {
        throw new DocumentSourceRejectedError("html_wrapper_policy", {
          ...safeContext,
          rejectionStage: "form_input_type",
          rejectedInputType: this.#safeRejectedInputType(
            declaredType === undefined ? "missing" : type,
          ),
        });
      }
      const name = this.#htmlAttribute(inputAttributes, "name");
      const value = this.#htmlAttribute(inputAttributes, "value") ?? "";
      if (type === "text" && value.length === 0) {
        if (!name || challengeFieldName !== undefined || name.length > 128) {
          throw new DocumentSourceRejectedError("html_wrapper_policy", {
            ...safeContext,
            rejectionStage: "form_empty_text",
          });
        }
        challengeFieldName = name;
        challengeFieldOffset = inputMatch.index;
        continue;
      }
      if (
        !name ||
        name.length > 128 ||
        value.length > 8_192 ||
        parameters.size >= MAX_FORM_FIELDS
      ) {
        throw new DocumentSourceRejectedError("html_wrapper_policy", {
          ...safeContext,
          rejectionStage: "form_field_policy",
        });
      }
      parameters.append(name, value);
    }
    const body = parameters.toString();
    if (
      parameters.size === 0 ||
      Buffer.byteLength(body, "utf-8") > MAX_FORM_BYTES
    ) {
      throw new DocumentSourceRejectedError("html_wrapper_policy", {
        ...safeContext,
        rejectionStage: "form_body_policy",
      });
    }
    if (challengeFieldName !== undefined) {
      const markedCaptchaImages = [
        ...html.matchAll(/<img\b([^>]*(?:captcha|infraCaptcha)[^>]*)>/giu),
      ];
      const adjacentImages = [...formBody.matchAll(/<img\b([^>]*)>/giu)].filter(
        (match) =>
          challengeFieldOffset !== undefined &&
          Math.abs((match.index ?? 0) - challengeFieldOffset) <= 4_096,
      );
      const captchaImages = [...markedCaptchaImages, ...adjacentImages];
      const remoteImageCandidates = new Map<string, ChallengeImageSource>();
      const inlineImageCandidates = new Map<string, ChallengeImageSource>();
      const seenSources = new Set<string>();
      let missingSourceCount = 0;
      let dataSourceCount = 0;
      let sameHostHttpsCount = 0;
      let allowedCrossHostHttpsCount = 0;
      let rejectedSourceCount = 0;
      for (const [, attributes = ""] of captchaImages) {
        const source = this.#htmlAttribute(attributes, "src");
        if (!source) {
          missingSourceCount += 1;
          continue;
        }
        if (seenSources.has(source)) continue;
        seenSources.add(source);
        try {
          const candidate = new URL(source, pageUrl);
          if (candidate.protocol === "data:") {
            dataSourceCount += 1;
            const image = this.#parseInlineChallengeImage(source);
            if (image && this.#isDisplayableChallengeImage(image)) {
              const imageHash = createHash("sha256")
                .update(image.bytes)
                .digest("hex");
              inlineImageCandidates.set(`inline:${image.mediaType}:${imageHash}`, {
                kind: "inline",
                image,
              });
            } else {
              rejectedSourceCount += 1;
            }
          } else if (candidate.protocol !== "https:" || candidate.port !== "") {
            rejectedSourceCount += 1;
          } else if (
            candidate.hostname.toLowerCase() === pageUrl.hostname.toLowerCase()
          ) {
            sameHostHttpsCount += 1;
            const validated = this.#validateUrl(candidate.toString()).toString();
            remoteImageCandidates.set(`remote:${validated}`, {
              kind: "remote",
              url: validated,
            });
          } else if (this.#allowedHosts.has(candidate.hostname.toLowerCase())) {
            allowedCrossHostHttpsCount += 1;
          } else {
            rejectedSourceCount += 1;
          }
        } catch {
          rejectedSourceCount += 1;
        }
      }
      const staticImageUrls = this.#challengeStaticImageUrls(pageUrl, formBody);
      for (const staticImageUrl of staticImageUrls) {
        remoteImageCandidates.set(`remote:${staticImageUrl}`, {
          kind: "remote",
          url: staticImageUrl,
        });
      }
      const challengeSafeContext: DocumentRejectionSafeContext = {
        ...safeContext,
        captchaImageCandidateCount: seenSources.size + missingSourceCount,
        captchaImageMissingSourceCount: missingSourceCount,
        captchaImageDataSourceCount: dataSourceCount,
        captchaImageSameHostHttpsCount: sameHostHttpsCount,
        captchaImageAllowedCrossHostHttpsCount: allowedCrossHostHttpsCount,
        captchaImageRejectedSourceCount: rejectedSourceCount,
        captchaStaticSameHostUrlCount: staticImageUrls.length,
      };
      const uniqueImages =
        remoteImageCandidates.size === 1
          ? [...remoteImageCandidates.values()]
          : remoteImageCandidates.size === 0
            ? [...inlineImageCandidates.values()]
            : [];
      if (uniqueImages.length !== 1) {
        throw new DocumentSourceRejectedError("html_wrapper_policy", {
          ...challengeSafeContext,
          rejectionStage: "form_empty_text",
        });
      }
      return {
        url: action.toString(),
        body,
        challengeFieldName,
        imageSource: uniqueImages[0]!,
        safeContext: challengeSafeContext,
      };
    }
    return { url: action.toString(), body, safeContext };
  }

  async #issueChallenge(
    reference: DocumentReference,
    form: HiddenPostChallenge,
    redirectCount: number,
    deadline: number,
    cookies: OriginCookieJar,
  ): Promise<never> {
    let image: ChallengeImage;
    try {
      image =
        form.imageSource.kind === "inline"
          ? form.imageSource.image
          : await this.#fetchChallengeImage(
              form.imageSource.url,
              deadline,
              cookies,
              0,
            );
    } catch (error) {
      if (error instanceof ChallengeResourceRejectedError) {
        throw new DocumentSourceRejectedError("document_validation", {
          ...form.safeContext,
          ...error.safeContext,
        });
      }
      throw error;
    }
    this.#pruneChallenges();
    if (this.#challenges.size >= MAX_ACTIVE_CHALLENGES) {
      const oldest = this.#challenges.keys().next().value;
      if (oldest) this.#challenges.delete(oldest);
    }
    const challengeId = randomUUID();
    const expiresAtMs = this.#now() + CHALLENGE_TTL_MS;
    this.#challenges.set(challengeId, {
      ...form,
      reference: { ...reference, scope: { ...reference.scope } },
      cookies: this.#cloneCookies(cookies),
      redirectCount,
      expiresAtMs,
    });
    throw new DocumentChallengeRequiredError(
      challengeId,
      `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`,
      new Date(expiresAtMs).toISOString(),
    );
  }

  async #fetchChallengeImage(
    sourceUrl: string,
    deadline: number,
    cookies: OriginCookieJar,
    redirectCount: number,
  ): Promise<ChallengeImage> {
    const url = this.#validateUrl(sourceUrl);
    const addresses = await this.#resolvePublicAddresses(url.hostname);
    const remainingTimeMs = deadline - this.#now();
    if (remainingTimeMs <= 0) throw new DocumentSourceUnavailableError();
    let response: DocumentTransportResponse;
    try {
      const cookie = this.#cookieHeader(url, cookies);
      response = await this.#transport.get(url, addresses[0]!, {
        maxBytes: MAX_CHALLENGE_IMAGE_BYTES,
        timeoutMs: remainingTimeMs,
        ...(cookie ? { cookie } : {}),
      });
    } catch (error) {
      if (error instanceof DocumentSourceRejectedError) throw error;
      throw new DocumentSourceUnavailableError();
    }
    this.#captureOriginCookies(url, response.setCookies ?? [], cookies);
    if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
      const location = response.headers.location;
      if (!location || redirectCount >= 2) {
        throw new DocumentSourceRejectedError("redirect_policy");
      }
      return this.#fetchChallengeImage(
        new URL(location, url).toString(),
        deadline,
        cookies,
        redirectCount + 1,
      );
    }
    const mediaType = response.headers["content-type"]
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const image = this.#validatedChallengeImage(mediaType, response.bytes);
    if (
      response.statusCode !== 200 ||
      !image ||
      !this.#isDisplayableChallengeImage(image)
    ) {
      const dimensions = image
        ? this.#challengeImageDimensions(image)
        : undefined;
      throw new ChallengeResourceRejectedError({
        challengeResourceStatusCode: response.statusCode,
        challengeResourceMediaCategory: this.#mediaCategory(mediaType),
        challengeResourceMagicCategory: this.#magicCategory(response.bytes),
        challengeResourceByteLength: response.bytes.byteLength,
        ...(dimensions
          ? {
              challengeResourceWidth: dimensions.width,
              challengeResourceHeight: dimensions.height,
            }
          : {}),
      });
    }
    return image;
  }

  #parseInlineChallengeImage(source: string): ChallengeImage | undefined {
    const match =
      /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
        source,
      );
    if (!match?.[1] || !match[2] || match[2].length % 4 !== 0) return undefined;
    if (match[2].length > Math.ceil(MAX_CHALLENGE_IMAGE_BYTES / 3) * 4 + 4) {
      return undefined;
    }
    const bytes = Buffer.from(match[2], "base64");
    if (
      bytes.byteLength > MAX_CHALLENGE_IMAGE_BYTES ||
      bytes
        .toString("base64")
        .replace(/=+$/u, "") !== match[2].replace(/=+$/u, "")
    ) {
      return undefined;
    }
    return this.#validatedChallengeImage(match[1], bytes);
  }

  #validatedChallengeImage(
    mediaType: string | undefined,
    rawBytes: Uint8Array,
  ): ChallengeImage | undefined {
    const bytes = Buffer.from(rawBytes);
    const valid =
      (mediaType === "image/png" &&
        bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
      (mediaType === "image/jpeg" &&
        bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) ||
      (mediaType === "image/gif" &&
        /^(?:GIF87a|GIF89a)$/u.test(bytes.subarray(0, 6).toString("ascii")));
    if (!valid) return undefined;
    return {
      bytes: rawBytes,
      mediaType,
    };
  }

  #isDisplayableChallengeImage(image: ChallengeImage): boolean {
    const dimensions = this.#challengeImageDimensions(image);
    return (
      dimensions !== undefined &&
      dimensions.width >= 40 &&
      dimensions.height >= 20 &&
      dimensions.width <= 2_000 &&
      dimensions.height <= 1_000 &&
      dimensions.width * dimensions.height <= 2_000_000
    );
  }

  #challengeImageDimensions(
    image: ChallengeImage,
  ): { width: number; height: number } | undefined {
    const bytes = Buffer.from(image.bytes);
    if (
      image.mediaType === "image/png" &&
      bytes.byteLength >= 24 &&
      bytes.subarray(12, 16).toString("ascii") === "IHDR"
    ) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (image.mediaType === "image/gif" && bytes.byteLength >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (image.mediaType === "image/jpeg") {
      let offset = 2;
      while (offset + 8 < bytes.byteLength) {
        if (bytes[offset] !== 0xff) return undefined;
        const marker = bytes[offset + 1] ?? 0;
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          ![0xc4, 0xc8, 0xcc].includes(marker)
        ) {
          return {
            height: bytes.readUInt16BE(offset + 5),
            width: bytes.readUInt16BE(offset + 7),
          };
        }
        const segmentLength = bytes.readUInt16BE(offset + 2);
        if (segmentLength < 2) return undefined;
        offset += segmentLength + 2;
      }
    }
    return undefined;
  }

  #mediaCategory(
    mediaType: string | undefined,
  ): NonNullable<DocumentRejectionSafeContext["challengeResourceMediaCategory"]> {
    if (!mediaType) return "missing";
    if (mediaType.startsWith("image/")) return "image";
    if (mediaType.startsWith("audio/")) return "audio";
    if (mediaType === "text/html") return "html";
    return "other";
  }

  #magicCategory(
    rawBytes: Uint8Array,
  ): NonNullable<DocumentRejectionSafeContext["challengeResourceMagicCategory"]> {
    const bytes = Buffer.from(rawBytes);
    if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      return "png";
    }
    if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "jpeg";
    if (/^(?:GIF87a|GIF89a)$/u.test(bytes.subarray(0, 6).toString("ascii"))) {
      return "gif";
    }
    if (
      bytes.subarray(0, 3).toString("ascii") === "ID3" ||
      bytes.subarray(0, 4).toString("ascii") === "RIFF" ||
      bytes.subarray(0, 4).toString("ascii") === "OggS"
    ) {
      return "audio";
    }
    const prefix = bytes.subarray(0, 32).toString("utf-8").trimStart();
    if (/^(?:<!doctype\s+html|<html\b)/iu.test(prefix)) return "html";
    if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
    return "other";
  }

  #pruneChallenges(): void {
    const now = this.#now();
    for (const [challengeId, challenge] of this.#challenges) {
      if (challenge.expiresAtMs <= now) this.#challenges.delete(challengeId);
    }
  }

  #sameReference(left: DocumentReference, right: DocumentReference): boolean {
    return (
      left.caseId === right.caseId &&
      left.documentId === right.documentId &&
      left.sourceUrl === right.sourceUrl &&
      JSON.stringify(left.scope) === JSON.stringify(right.scope)
    );
  }

  #cloneCookies(cookies: OriginCookieJar): OriginCookieJar {
    return new Map(
      [...cookies].map(([hostname, values]) => [hostname, new Map(values)]),
    );
  }

  #htmlAttribute(attributes: string, name: string): string | undefined {
    const expression = new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` +
        "`" +
        `]+))`,
      "iu",
    );
    const match = expression.exec(attributes);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value === undefined ? undefined : decodeHTMLAttribute(value);
  }

  #challengeStaticImageUrls(pageUrl: URL, html: string): string[] {
    const values = [
      ...html.matchAll(
        /\b(?:src|data-src|data-url|data-endpoint)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu,
      ),
      ...html.matchAll(
        /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]+))\s*\)/giu,
      ),
    ].flatMap((match) => {
      const value = match[1] ?? match[2] ?? match[3];
      if (!value || !/captcha/iu.test(value)) return [];
      try {
        const candidate = this.#validateUrl(
          new URL(decodeHTMLAttribute(value), pageUrl).toString(),
        );
        return candidate.hostname.toLowerCase() === pageUrl.hostname.toLowerCase()
          ? [candidate.toString()]
          : [];
      } catch {
        return [];
      }
    });
    return [...new Set(values)];
  }

  #safeRejectedInputType(
    type: string,
  ): NonNullable<DocumentRejectionSafeContext["rejectedInputType"]> {
    const safeTypes = new Set([
      "missing",
      "text",
      "password",
      "file",
      "checkbox",
      "radio",
      "email",
      "number",
      "search",
      "tel",
      "url",
      "date",
    ]);
    return safeTypes.has(type)
      ? (type as NonNullable<
          DocumentRejectionSafeContext["rejectedInputType"]
        >)
      : "other";
  }

  #requestLimits(
    url: URL,
    timeoutMs: number,
    cookies: OriginCookieJar,
  ): DocumentRequestLimits {
    const cookie = this.#cookieHeader(url, cookies);
    return {
      maxBytes: this.#maxBytes,
      timeoutMs,
      ...(cookie ? { cookie } : {}),
    };
  }

  #captureOriginCookies(
    url: URL,
    setCookies: readonly string[],
    cookies: OriginCookieJar,
  ): void {
    if (setCookies.length === 0) return;
    const originCookies = cookies.get(url.hostname) ?? new Map<string, string>();
    for (const rawCookie of setCookies.slice(0, 20)) {
      const pair = rawCookie.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const containsUnsafeValueCharacter = [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 || character === ";";
      });
      if (
        !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name) ||
        containsUnsafeValueCharacter ||
        value.length > 4_096
      ) {
        continue;
      }
      originCookies.set(name, value);
    }
    if (originCookies.size > 0) cookies.set(url.hostname, originCookies);
  }

  #cookieHeader(url: URL, cookies: OriginCookieJar): string | undefined {
    const originCookies = cookies.get(url.hostname);
    if (!originCookies || originCookies.size === 0) return undefined;
    const header = [...originCookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (Buffer.byteLength(header, "utf-8") > MAX_COOKIE_BYTES) {
      throw new DocumentSourceRejectedError("html_wrapper_policy");
    }
    return header;
  }

  #htmlSafeContext(
    pageUrl: URL,
    html: string,
    headers: Readonly<Record<string, string | undefined>>,
  ): DocumentRejectionSafeContext {
    const forms = [...html.matchAll(/<form\b([^>]*)>/giu)];
    const postFormCount = forms.filter(([, attributes = ""]) =>
      /\bmethod\s*=\s*(["'])?post\1(?:\s|$)/iu.test(attributes),
    ).length;
    const sameHostFormActionCount = forms.filter(([, attributes = ""]) => {
      const actionMatch = /\baction\s*=\s*(["'])(.*?)\1/iu.exec(attributes);
      if (!actionMatch?.[2]) return false;
      try {
        const action = new URL(
          decodeHTMLAttribute(actionMatch[2]),
          pageUrl,
        );
        return (
          action.protocol === "https:" &&
          action.port === "" &&
          action.hostname.toLowerCase() === pageUrl.hostname.toLowerCase()
        );
      } catch {
        return false;
      }
    }).length;

    return {
      formCount: forms.length,
      postFormCount,
      hiddenInputCount: (
        html.match(
          /<input\b[^>]*\btype\s*=\s*(?:["']hidden["']|hidden)(?:\s|\/?>)/giu,
        ) ?? []
      ).length,
      scriptCount: (html.match(/<script\b/giu) ?? []).length,
      anchorCount: (html.match(/<a\b/giu) ?? []).length,
      iframeCount: (html.match(/<iframe\b/giu) ?? []).length,
      embedCount: (html.match(/<embed\b/giu) ?? []).length,
      objectCount: (html.match(/<object\b/giu) ?? []).length,
      metaRefreshCount: (
        html.match(/<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1/giu) ?? []
      ).length,
      sameHostFormActionCount,
      setsCookie: headers["set-cookie"] !== undefined,
      documentImplementationHintCount: (
        html.match(/acessar_documento_implementacao/giu) ?? []
      ).length,
      printDocumentHintCount: (html.match(/minuta_imprimir/giu) ?? []).length,
      ajaxHintCount: (html.match(/\bajax\b/giu) ?? []).length,
      humanChallengeTextHintCount: (
        html.match(
          /(?:captcha|c[oó]digo\s+(?:de\s+)?(?:seguran[cç]a|imagem)|n[aã]o\s+sou\s+rob[oô])/giu,
        ) ?? []
      ).length,
      challengeFieldHintCount: (
        html.match(
          /\b(?:name|id)\s*=\s*(["'])[^"']*(?:captcha|c[oó]digo|seguran[cç]a)[^"']*\1/giu,
        ) ?? []
      ).length,
      captchaImageHintCount: (
        html.match(/<img\b[^>]*(?:captcha|infraCaptcha)[^>]*>/giu) ?? []
      ).length,
    };
  }

  async #resolvePublicAddresses(
    hostname: string,
  ): Promise<readonly ResolvedHostAddress[]> {
    let addresses: readonly ResolvedHostAddress[];
    try {
      addresses = await this.#resolver.resolve(hostname);
    } catch {
      throw new DocumentSourceUnavailableError();
    }
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
      throw new DocumentSourceRejectedError("dns_policy");
    }
    return addresses;
  }
}
