import { isAbsolute, relative, resolve } from "node:path";

import { isValidGcsBucketName } from "./gcs-bucket.js";

export type AuthenticationMode = "disabled" | "firebase";
export type BrowserRendererAuthenticationMode =
  | "disabled"
  | "google-id-token";

export type FoundationRuntimeConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "postgres";
      readonly databaseUrl: string;
      readonly poolMax: number;
      readonly activeKeyVersion: string;
      readonly encryptionKeys: ReadonlyMap<string, Uint8Array>;
      readonly blindIndexVersion: string;
      readonly blindIndexKey: Uint8Array;
    };

export type DocumentDeliveryRuntimeConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "local";
      readonly objectRoot: string;
      readonly quotaPerMinute: number;
      readonly maximumBytes: number;
    }
  | {
      readonly mode: "gcs";
      readonly bucketName: string;
      readonly quotaPerMinute: number;
      readonly maximumBytes: number;
    };

export type BillingRuntimeConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "stripe-test";
      readonly applicationUrl: string;
      readonly webhookDatabaseUrl: string;
      readonly stripeSecretKey: string;
      readonly stripeWebhookSecret: string;
      readonly personPriceId: string;
    };

export interface RuntimeConfig {
  readonly authenticationMode: AuthenticationMode;
  readonly browserRendererAuthenticationMode: BrowserRendererAuthenticationMode;
  readonly browserRendererUrl?: string;
  readonly billing: BillingRuntimeConfig;
  readonly djenSearchProxyUrl?: string;
  readonly documentDelivery: DocumentDeliveryRuntimeConfig;
  readonly foundation: FoundationRuntimeConfig;
  readonly port: number;
}

export class RuntimeConfigurationError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = "RuntimeConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

const readEnum = <T extends string>(
  field: string,
  value: string | undefined,
  fallback: T,
  supported: readonly T[],
): T => {
  const resolved = value ?? fallback;
  if (!supported.includes(resolved as T)) {
    throw new RuntimeConfigurationError(field);
  }
  return resolved as T;
};

const readPort = (value: string | undefined): number => {
  const port = Number(value ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RuntimeConfigurationError("PORT");
  }
  return port;
};

const VERSION_PATTERN = /^v[1-9]\d*$/;

const required = (field: string, value: string | undefined): string => {
  if (!value) throw new RuntimeConfigurationError(field);
  return value;
};

const readBoundedInteger = (
  field: string,
  value: string | undefined,
  fallback: number,
  maximum: number,
): number => {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RuntimeConfigurationError(field);
  }
  return parsed;
};

const readVersion = (field: string, value: string | undefined): string => {
  const version = required(field, value);
  if (!VERSION_PATTERN.test(version)) throw new RuntimeConfigurationError(field);
  return version;
};

const readKey = (field: string, value: unknown): Buffer => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RuntimeConfigurationError(field);
  }
  const key = Buffer.from(value, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== value) {
    throw new RuntimeConfigurationError(field);
  }
  return key;
};

const readDatabaseUrl = (field: string, value: string | undefined): string => {
  const raw = required(field, value);
  try {
    const url = new URL(raw);
    const sslModes = url.searchParams.getAll("sslmode");
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      sslModes.length > 1 ||
      (sslModes.length === 1 &&
        !["require", "verify-ca", "verify-full"].includes(sslModes[0]!))
    ) {
      throw new RuntimeConfigurationError(field);
    }
    return raw;
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    throw new RuntimeConfigurationError(field);
  }
};

const readEncryptionKeys = (value: string | undefined): ReadonlyMap<string, Uint8Array> => {
  const field = "IDENTIFIER_ENCRYPTION_KEYS_JSON";
  const raw = required(field, value);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    ) {
      throw new RuntimeConfigurationError(field);
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (
      entries.length < 1 ||
      entries.length > 8 ||
      entries.some(([version]) => !VERSION_PATTERN.test(version))
    ) {
      throw new RuntimeConfigurationError(field);
    }
    return new Map(entries.map(([version, key]) => [version, readKey(field, key)]));
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    throw new RuntimeConfigurationError(field);
  }
};

const readFoundation = (environment: Environment): FoundationRuntimeConfig => {
  const mode = readEnum(
    "FOUNDATION_MODE",
    environment.FOUNDATION_MODE,
    "disabled",
    ["disabled", "postgres"] as const,
  );
  if (mode === "disabled") {
    const foundationFields = [
      "DATABASE_URL",
      "DATABASE_POOL_MAX",
      "IDENTIFIER_ACTIVE_KEY_VERSION",
      "IDENTIFIER_ENCRYPTION_KEYS_JSON",
      "IDENTIFIER_BLIND_INDEX_VERSION",
      "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL",
    ] as const;
    if (foundationFields.some((field) => Boolean(environment[field]))) {
      throw new RuntimeConfigurationError("FOUNDATION_MODE");
    }
    return { mode };
  }

  const databaseUrl = readDatabaseUrl("DATABASE_URL", environment.DATABASE_URL);
  const activeKeyVersion = readVersion(
    "IDENTIFIER_ACTIVE_KEY_VERSION",
    environment.IDENTIFIER_ACTIVE_KEY_VERSION,
  );
  const encryptionKeys = readEncryptionKeys(
    environment.IDENTIFIER_ENCRYPTION_KEYS_JSON,
  );
  if (!encryptionKeys.has(activeKeyVersion)) {
    throw new RuntimeConfigurationError("IDENTIFIER_ACTIVE_KEY_VERSION");
  }
  return {
    mode,
    databaseUrl,
    poolMax: readBoundedInteger(
      "DATABASE_POOL_MAX",
      environment.DATABASE_POOL_MAX,
      5,
      20,
    ),
    activeKeyVersion,
    encryptionKeys,
    blindIndexVersion: readVersion(
      "IDENTIFIER_BLIND_INDEX_VERSION",
      environment.IDENTIFIER_BLIND_INDEX_VERSION,
    ),
    blindIndexKey: readKey(
      "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL",
      environment.IDENTIFIER_BLIND_INDEX_KEY_BASE64URL,
    ),
  };
};

const readBilling = (environment: Environment): BillingRuntimeConfig => {
  const mode = readEnum(
    "BILLING_MODE", environment.BILLING_MODE, "disabled",
    ["disabled", "stripe-test"] as const,
  );
  const fields = [
    "APPLICATION_PUBLIC_URL",
    "BILLING_WEBHOOK_CONFIG_JSON",
    "BILLING_WEBHOOK_DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PERSON_PRICE_ID",
  ] as const;
  if (mode === "disabled") {
    if (fields.some((field) => Boolean(environment[field]))) {
      throw new RuntimeConfigurationError("BILLING_MODE");
    }
    return { mode };
  }
  const applicationUrl = required(
    "APPLICATION_PUBLIC_URL", environment.APPLICATION_PUBLIC_URL,
  );
  try {
    const url = new URL(applicationUrl);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.protocol === "http:";
    if (
      (!local && url.protocol !== "https:") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash
    ) throw new RuntimeConfigurationError("APPLICATION_PUBLIC_URL");
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    throw new RuntimeConfigurationError("APPLICATION_PUBLIC_URL");
  }
  const stripeSecretKey = required("STRIPE_SECRET_KEY", environment.STRIPE_SECRET_KEY);
  let webhookDatabaseUrl = environment.BILLING_WEBHOOK_DATABASE_URL;
  let stripeWebhookSecret = environment.STRIPE_WEBHOOK_SECRET;
  if (environment.BILLING_WEBHOOK_CONFIG_JSON) {
    if (webhookDatabaseUrl || stripeWebhookSecret) {
      throw new RuntimeConfigurationError("BILLING_WEBHOOK_CONFIG_JSON");
    }
    try {
      const parsed: unknown = JSON.parse(environment.BILLING_WEBHOOK_CONFIG_JSON);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("invalid bundle");
      }
      const bundle = parsed as Readonly<Record<string, unknown>>;
      const keys = Object.keys(bundle).sort();
      if (
        keys.join(",") !== "databaseUrl,signingSecret" ||
        typeof bundle.databaseUrl !== "string" ||
        typeof bundle.signingSecret !== "string"
      ) throw new Error("invalid bundle");
      webhookDatabaseUrl = bundle.databaseUrl;
      stripeWebhookSecret = bundle.signingSecret;
    } catch {
      throw new RuntimeConfigurationError("BILLING_WEBHOOK_CONFIG_JSON");
    }
  }
  stripeWebhookSecret = required("STRIPE_WEBHOOK_SECRET", stripeWebhookSecret);
  const personPriceId = required(
    "STRIPE_PERSON_PRICE_ID", environment.STRIPE_PERSON_PRICE_ID,
  );
  if (!/^sk_test_[A-Za-z0-9]{24,255}$/.test(stripeSecretKey)) {
    throw new RuntimeConfigurationError("STRIPE_SECRET_KEY");
  }
  if (!/^whsec_[A-Za-z0-9]{24,255}$/.test(stripeWebhookSecret)) {
    throw new RuntimeConfigurationError("STRIPE_WEBHOOK_SECRET");
  }
  if (!/^price_[A-Za-z0-9]{8,255}$/.test(personPriceId)) {
    throw new RuntimeConfigurationError("STRIPE_PERSON_PRICE_ID");
  }
  return {
    mode,
    applicationUrl,
    webhookDatabaseUrl: readDatabaseUrl(
      "BILLING_WEBHOOK_DATABASE_URL", webhookDatabaseUrl,
    ),
    stripeSecretKey,
    stripeWebhookSecret,
    personPriceId,
  };
};

const readDocumentDelivery = (
  environment: Environment,
): DocumentDeliveryRuntimeConfig => {
  const mode = readEnum(
    "DOCUMENT_DELIVERY_MODE",
    environment.DOCUMENT_DELIVERY_MODE,
    "disabled",
    ["disabled", "local", "gcs"] as const,
  );
  const relatedFields = [
    "DOCUMENT_OBJECT_ROOT",
    "DOCUMENT_GCS_BUCKET",
    "DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE",
    "DOCUMENT_MAX_BYTES",
  ] as const;
  if (mode === "disabled") {
    if (relatedFields.some((field) => Boolean(environment[field]))) {
      throw new RuntimeConfigurationError("DOCUMENT_DELIVERY_MODE");
    }
    return { mode };
  }
  const limits = {
    quotaPerMinute: readBoundedInteger(
      "DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE",
      environment.DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE,
      20,
      100,
    ),
    maximumBytes: readBoundedInteger(
      "DOCUMENT_MAX_BYTES",
      environment.DOCUMENT_MAX_BYTES,
      25 * 1024 * 1024,
      25 * 1024 * 1024,
    ),
  };
  if (mode === "gcs") {
    if (environment.DOCUMENT_OBJECT_ROOT) {
      throw new RuntimeConfigurationError("DOCUMENT_OBJECT_ROOT");
    }
    if (!isValidGcsBucketName(environment.DOCUMENT_GCS_BUCKET)) {
      throw new RuntimeConfigurationError("DOCUMENT_GCS_BUCKET");
    }
    return { mode, bucketName: environment.DOCUMENT_GCS_BUCKET, ...limits };
  }
  if (environment.DOCUMENT_GCS_BUCKET) {
    throw new RuntimeConfigurationError("DOCUMENT_GCS_BUCKET");
  }
  const objectRoot = required(
    "DOCUMENT_OBJECT_ROOT", environment.DOCUMENT_OBJECT_ROOT,
  );
  const absoluteRoot = resolve(objectRoot);
  const webRoot = resolve("dist/web");
  const relativeToWeb = relative(webRoot, absoluteRoot);
  if (!isAbsolute(objectRoot) || relativeToWeb === "" ||
      (!relativeToWeb.startsWith("..") && !isAbsolute(relativeToWeb))) {
    throw new RuntimeConfigurationError("DOCUMENT_OBJECT_ROOT");
  }
  return { mode, objectRoot: absoluteRoot, ...limits };
};

const readHttpUrl = (
  field: string,
  value: string | undefined,
  expectedPath: string,
): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== expectedPath ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new RuntimeConfigurationError(field);
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    throw new RuntimeConfigurationError(field);
  }
};

export const readRuntimeConfig = (environment: Environment): RuntimeConfig => {
  const browserRendererUrl = readHttpUrl(
    "BROWSER_RENDERER_URL",
    environment.BROWSER_RENDERER_URL,
    "/",
  );
  const djenSearchProxyUrl = readHttpUrl(
    "DJEN_SEARCH_PROXY_URL",
    environment.DJEN_SEARCH_PROXY_URL,
    "/search-djen",
  );

  const foundation = readFoundation(environment);
  const documentDelivery = readDocumentDelivery(environment);
  const billing = readBilling(environment);
  if (documentDelivery.mode !== "disabled" && foundation.mode !== "postgres") {
    throw new RuntimeConfigurationError("FOUNDATION_MODE");
  }
  if (billing.mode !== "disabled" && foundation.mode !== "postgres") {
    throw new RuntimeConfigurationError("FOUNDATION_MODE");
  }
  return {
    authenticationMode: readEnum(
      "AUTH_MODE",
      environment.AUTH_MODE,
      "disabled",
      ["disabled", "firebase"],
    ),
    browserRendererAuthenticationMode: readEnum(
      "BROWSER_RENDERER_AUTH_MODE",
      environment.BROWSER_RENDERER_AUTH_MODE,
      "google-id-token",
      ["disabled", "google-id-token"],
    ),
    ...(browserRendererUrl ? { browserRendererUrl } : {}),
    ...(djenSearchProxyUrl ? { djenSearchProxyUrl } : {}),
    billing,
    documentDelivery,
    foundation,
    port: readPort(environment.PORT),
  };
};
