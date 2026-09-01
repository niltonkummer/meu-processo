import { describe, expect, it } from "vitest";

import {
  RuntimeConfigurationError,
  readRuntimeConfig,
} from "./runtime-config.js";

describe("runtime configuration", () => {
  it("returns explicit safe defaults without mutating the environment", () => {
    const environment = {};

    expect(readRuntimeConfig(environment)).toEqual({
      authenticationMode: "disabled",
      billing: { mode: "disabled" },
      browserRendererAuthenticationMode: "google-id-token",
      documentDelivery: { mode: "disabled" },
      foundation: { mode: "disabled" },
      port: 8080,
    });
    expect(environment).toEqual({});
  });

  it("parses supported values and validated URLs", () => {
    expect(
      readRuntimeConfig({
        AUTH_MODE: "firebase",
        BROWSER_RENDERER_AUTH_MODE: "disabled",
        BROWSER_RENDERER_URL: "http://browser-renderer:8080",
        DJEN_SEARCH_PROXY_URL:
          "https://collector.internal.example/search-djen",
        DOCUMENT_DELIVERY_MODE: "local",
        DOCUMENT_OBJECT_ROOT: "/var/lib/meu-processo/documents",
        DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE: "17",
        DOCUMENT_MAX_BYTES: "1048576",
        FOUNDATION_MODE: "postgres",
        DATABASE_URL:
          "postgresql://runtime:password@database.internal:5432/meu_processo?sslmode=require",
        DATABASE_POOL_MAX: "7",
        IDENTIFIER_ACTIVE_KEY_VERSION: "v2",
        IDENTIFIER_ENCRYPTION_KEYS_JSON:
          '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE","v2":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"}',
        IDENTIFIER_BLIND_INDEX_VERSION: "v1",
        IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
          "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
        PORT: "9090",
      }),
    ).toEqual({
      authenticationMode: "firebase",
      billing: { mode: "disabled" },
      browserRendererAuthenticationMode: "disabled",
      browserRendererUrl: "http://browser-renderer:8080",
      djenSearchProxyUrl:
        "https://collector.internal.example/search-djen",
      documentDelivery: {
        mode: "local",
        objectRoot: "/var/lib/meu-processo/documents",
        quotaPerMinute: 17,
        maximumBytes: 1048576,
      },
      foundation: {
        mode: "postgres",
        databaseUrl:
          "postgresql://runtime:password@database.internal:5432/meu_processo?sslmode=require",
        poolMax: 7,
        activeKeyVersion: "v2",
        encryptionKeys: new Map([
          ["v1", Buffer.alloc(32, 1)],
          ["v2", Buffer.alloc(32, 2)],
        ]),
        blindIndexVersion: "v1",
        blindIndexKey: Buffer.alloc(32, 3),
      },
      port: 9090,
    });
  });

  it("parses Stripe test billing without accepting live credentials", () => {
    const config = readRuntimeConfig({
      BILLING_MODE: "stripe-test",
      APPLICATION_PUBLIC_URL: "https://validation.meu-processo.example",
      BILLING_WEBHOOK_DATABASE_URL:
        "postgresql://app_billing_webhook:password@database/meu_processo?sslmode=require",
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
      FOUNDATION_MODE: "postgres",
      DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
      IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
      IDENTIFIER_ENCRYPTION_KEYS_JSON:
        '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
      IDENTIFIER_BLIND_INDEX_VERSION: "v1",
      IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
        "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
    });
    expect(config.billing).toEqual({
      mode: "stripe-test",
      applicationUrl: "https://validation.meu-processo.example",
      webhookDatabaseUrl:
        "postgresql://app_billing_webhook:password@database/meu_processo?sslmode=require",
      stripeSecretKey: "sk_test_1234567890abcdefghijklmnop",
      stripeWebhookSecret: "whsec_1234567890abcdefghijklmnop",
      personPriceId: "price_12345678ABC",
    });
  });

  it("parses the cost-bounded webhook secret bundle used by Cloud Run", () => {
    const config = readRuntimeConfig({
      BILLING_MODE: "stripe-test",
      APPLICATION_PUBLIC_URL: "https://validation.meu-processo.example",
      BILLING_WEBHOOK_CONFIG_JSON: JSON.stringify({
        databaseUrl:
          "postgresql://app_billing_webhook:password@database/meu_processo?sslmode=require",
        signingSecret: "whsec_1234567890abcdefghijklmnop",
      }),
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
      FOUNDATION_MODE: "postgres",
      DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
      IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
      IDENTIFIER_ENCRYPTION_KEYS_JSON:
        '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
      IDENTIFIER_BLIND_INDEX_VERSION: "v1",
      IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
        "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
    });
    expect(config.billing).toMatchObject({
      mode: "stripe-test",
      webhookDatabaseUrl:
        "postgresql://app_billing_webhook:password@database/meu_processo?sslmode=require",
      stripeWebhookSecret: "whsec_1234567890abcdefghijklmnop",
    });
  });

  it.each([
    [{ STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop" }, "BILLING_MODE"],
    [{ BILLING_MODE: "stripe-live" }, "BILLING_MODE"],
    [{ BILLING_MODE: "stripe-test" }, "APPLICATION_PUBLIC_URL"],
    [{ BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://public.example" }, "APPLICATION_PUBLIC_URL"],
    [{ BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "not-a-url" }, "APPLICATION_PUBLIC_URL"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_CONFIG_JSON: "not-json",
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "BILLING_WEBHOOK_CONFIG_JSON"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_CONFIG_JSON: "[]",
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "BILLING_WEBHOOK_CONFIG_JSON"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_CONFIG_JSON: JSON.stringify({
        databaseUrl: 7,
        signingSecret: "whsec_1234567890abcdefghijklmnop",
      }),
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "BILLING_WEBHOOK_CONFIG_JSON"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_CONFIG_JSON: '{"databaseUrl":"postgresql://webhook:password@database/app"}',
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "BILLING_WEBHOOK_CONFIG_JSON"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_CONFIG_JSON: JSON.stringify({
        databaseUrl: "postgresql://webhook:password@database/app",
        signingSecret: "whsec_1234567890abcdefghijklmnop",
      }),
      BILLING_WEBHOOK_DATABASE_URL: "postgresql://webhook:password@database/app",
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "BILLING_WEBHOOK_CONFIG_JSON"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_DATABASE_URL: "postgresql://webhook:password@database/app",
      STRIPE_SECRET_KEY: "sk_live_invalid",
      STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "STRIPE_SECRET_KEY"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_DATABASE_URL: "postgresql://webhook:password@database/app",
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_WEBHOOK_SECRET: "bad",
      STRIPE_PERSON_PRICE_ID: "price_12345678ABC",
    }, "STRIPE_WEBHOOK_SECRET"],
    [{
      BILLING_MODE: "stripe-test", APPLICATION_PUBLIC_URL: "http://127.0.0.1:18080",
      BILLING_WEBHOOK_DATABASE_URL: "postgresql://webhook:password@database/app",
      STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
      STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdefghijklmnop",
      STRIPE_PERSON_PRICE_ID: "bad",
    }, "STRIPE_PERSON_PRICE_ID"],
  ])("rejects unsafe billing configuration %#", (environment, field) => {
    expect(() => readRuntimeConfig(environment)).toThrow(
      new RuntimeConfigurationError(field),
    );
  });

  it("parses an explicit GCS document backend without credentials", () => {
    const config = readRuntimeConfig({
      DOCUMENT_DELIVERY_MODE: "gcs",
      DOCUMENT_GCS_BUCKET: "meu-processo-validation",
      DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE: "17",
      DOCUMENT_MAX_BYTES: "1048576",
      FOUNDATION_MODE: "postgres",
      DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
      IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
      IDENTIFIER_ENCRYPTION_KEYS_JSON:
        '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
      IDENTIFIER_BLIND_INDEX_VERSION: "v1",
      IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
        "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
    });
    expect(config.documentDelivery).toEqual({
      mode: "gcs",
      bucketName: "meu-processo-validation",
      quotaPerMinute: 17,
      maximumBytes: 1_048_576,
    });
  });

  it.each([
    [{ DOCUMENT_DELIVERY_MODE: "remote" }, "DOCUMENT_DELIVERY_MODE"],
    [{ DOCUMENT_GCS_BUCKET: "meu-processo-validation" }, "DOCUMENT_DELIVERY_MODE"],
    [{ DOCUMENT_DELIVERY_MODE: "gcs" }, "DOCUMENT_GCS_BUCKET"],
    [
      { DOCUMENT_DELIVERY_MODE: "gcs", DOCUMENT_GCS_BUCKET: "gs://bucket" },
      "DOCUMENT_GCS_BUCKET",
    ],
    [
      {
        DOCUMENT_DELIVERY_MODE: "local",
        DOCUMENT_OBJECT_ROOT: "/tmp/documents",
        DOCUMENT_GCS_BUCKET: "meu-processo-validation",
      },
      "DOCUMENT_GCS_BUCKET",
    ],
    [{ DOCUMENT_OBJECT_ROOT: "/tmp/documents" }, "DOCUMENT_DELIVERY_MODE"],
    [{ DOCUMENT_DELIVERY_MODE: "local" }, "DOCUMENT_OBJECT_ROOT"],
    [
      { DOCUMENT_DELIVERY_MODE: "local", DOCUMENT_OBJECT_ROOT: "relative" },
      "DOCUMENT_OBJECT_ROOT",
    ],
    [
      {
        DOCUMENT_DELIVERY_MODE: "local",
        DOCUMENT_OBJECT_ROOT: `${process.cwd()}/dist/web/documents`,
      },
      "DOCUMENT_OBJECT_ROOT",
    ],
    [
      {
        DOCUMENT_DELIVERY_MODE: "local",
        DOCUMENT_OBJECT_ROOT: "/tmp/documents",
        DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE: "101",
      },
      "DOCUMENT_DOWNLOAD_QUOTA_PER_MINUTE",
    ],
    [
      {
        DOCUMENT_DELIVERY_MODE: "local",
        DOCUMENT_OBJECT_ROOT: "/tmp/documents",
        DOCUMENT_MAX_BYTES: "26214401",
      },
      "DOCUMENT_MAX_BYTES",
    ],
    [{ FOUNDATION_MODE: "mysql" }, "FOUNDATION_MODE"],
    [
      {
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
      },
      "FOUNDATION_MODE",
    ],
    [{ FOUNDATION_MODE: "postgres" }, "DATABASE_URL"],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "mysql://runtime:password@database/meu_processo",
      },
      "DATABASE_URL",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo#fragment",
      },
      "DATABASE_URL",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
        IDENTIFIER_ACTIVE_KEY_VERSION: "latest",
      },
      "IDENTIFIER_ACTIVE_KEY_VERSION",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
        IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
        IDENTIFIER_ENCRYPTION_KEYS_JSON: "not-json",
      },
      "IDENTIFIER_ENCRYPTION_KEYS_JSON",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
        IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
        IDENTIFIER_ENCRYPTION_KEYS_JSON: '{"v1":"c2hvcnQ"}',
      },
      "IDENTIFIER_ENCRYPTION_KEYS_JSON",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
        IDENTIFIER_ACTIVE_KEY_VERSION: "v2",
        IDENTIFIER_ENCRYPTION_KEYS_JSON:
          '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
      },
      "IDENTIFIER_ACTIVE_KEY_VERSION",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
        IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
        IDENTIFIER_ENCRYPTION_KEYS_JSON:
          '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
        IDENTIFIER_BLIND_INDEX_VERSION: "v1",
        IDENTIFIER_BLIND_INDEX_KEY_BASE64URL: "invalid",
      },
      "IDENTIFIER_BLIND_INDEX_KEY_BASE64URL",
    ],
    [
      {
        FOUNDATION_MODE: "postgres",
        DATABASE_URL: "postgresql://runtime:password@database/meu_processo",
        IDENTIFIER_ACTIVE_KEY_VERSION: "v1",
        IDENTIFIER_ENCRYPTION_KEYS_JSON:
          '{"v1":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}',
        IDENTIFIER_BLIND_INDEX_VERSION: "v1",
        IDENTIFIER_BLIND_INDEX_KEY_BASE64URL:
          "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
        DATABASE_POOL_MAX: "21",
      },
      "DATABASE_POOL_MAX",
    ],
  ])("rejects unsafe foundation configuration", (environment, field) => {
    expect(() => readRuntimeConfig(environment)).toThrow(
      new RuntimeConfigurationError(field),
    );
  });

  it.each([
    [{ AUTH_MODE: "anonymous" }, "AUTH_MODE"],
    [{ BROWSER_RENDERER_AUTH_MODE: "token" }, "BROWSER_RENDERER_AUTH_MODE"],
    [{ PORT: "0" }, "PORT"],
    [{ PORT: "65536" }, "PORT"],
    [{ PORT: "8080.5" }, "PORT"],
    [{ BROWSER_RENDERER_URL: "not a url" }, "BROWSER_RENDERER_URL"],
    [{ BROWSER_RENDERER_URL: "ftp://renderer.example" }, "BROWSER_RENDERER_URL"],
    [{ DJEN_SEARCH_PROXY_URL: "file:///tmp/proxy" }, "DJEN_SEARCH_PROXY_URL"],
    [
      { DJEN_SEARCH_PROXY_URL: "https://collector.example/wrong-path" },
      "DJEN_SEARCH_PROXY_URL",
    ],
    [
      { DJEN_SEARCH_PROXY_URL: "https://user:pass@collector.example/search-djen" },
      "DJEN_SEARCH_PROXY_URL",
    ],
  ])("rejects invalid configuration before startup", (environment, field) => {
    expect(() => readRuntimeConfig(environment)).toThrow(
      new RuntimeConfigurationError(field),
    );
  });
});
