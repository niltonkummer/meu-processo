import { describe, expect, it, vi } from "vitest";

import { SafeAuthenticationError } from "./auth-client";
import {
  configureFirebaseBrowserAuth,
  fetchEmulatorVerificationDelivery,
  mapFirebaseProviderError,
  readFirebaseVerificationActionUrl,
  readFirebaseAuthEmulatorUrl,
  readFirebaseOptions,
} from "./firebase-auth-client";

describe("Firebase browser configuration", () => {
  it.each([
    [
      "auth/network-request-failed",
      "O navegador não conseguiu acessar a autenticação local em 127.0.0.1:9099.",
    ],
    [
      "auth/emulator-config-failed",
      "A autenticação local não foi conectada corretamente. Atualize a página e tente novamente.",
    ],
    [
      "auth/email-already-in-use",
      "Esta conta de teste já existe. Use Entrar ou reinicie o ambiente local.",
    ],
    [
      "auth/operation-not-allowed",
      "O cadastro por e-mail não está habilitado na autenticação local.",
    ],
    [
      "auth/invalid-api-key",
      "A configuração pública da autenticação local é inválida.",
    ],
  ])("explains the safe local provider category %s", (code, message) => {
    expect(mapFirebaseProviderError({ code }, true)).toEqual(
      new SafeAuthenticationError(message),
    );
  });

  it("does not disclose whether a cloud email account exists", () => {
    expect(
      mapFirebaseProviderError({ code: "auth/email-already-in-use" }, false),
    ).toEqual(
      new SafeAuthenticationError(
        "Não foi possível autenticar com os dados informados.",
      ),
    );
  });

  it("returns only a sanitized category for an unknown local error", () => {
    expect(
      mapFirebaseProviderError(
        {
          code: "auth/internal-error<script>",
          message: "sensitive-provider-message",
        },
        true,
      ),
    ).toEqual(
      new SafeAuthenticationError(
        "Falha na autenticação local (categoria: auth/internal-errorscript).",
      ),
    );
  });

  it("connects the emulator synchronously before starting persistence", async () => {
    const calls: string[] = [];
    const auth = { languageCode: null };

    await configureFirebaseBrowserAuth(
      auth,
      "http://127.0.0.1:9099/",
      {
        connect: () => calls.push("connect"),
        persist: () => {
          calls.push("persist");
          return Promise.resolve();
        },
      },
    );

    expect(calls).toEqual(["connect", "persist"]);
    expect(auth.languageCode).toBe("pt-BR");
  });

  it("configures cloud persistence without connecting an emulator", async () => {
    const calls: string[] = [];
    const auth = { languageCode: null };

    await configureFirebaseBrowserAuth(auth, undefined, {
      connect: () => calls.push("connect"),
      persist: () => {
        calls.push("persist");
        return Promise.resolve();
      },
    });

    expect(calls).toEqual(["persist"]);
    expect(auth.languageCode).toBe("pt-BR");
  });

  it("reads only the public Firebase web application fields", () => {
    expect(
      readFirebaseOptions({
        VITE_FIREBASE_BROWSER_KEY: "public-browser-key",
        VITE_FIREBASE_AUTH_DOMAIN: "project.firebaseapp.com",
        VITE_FIREBASE_PROJECT_ID: "project-id",
        VITE_FIREBASE_APP_ID: "web-app-id",
        FIREBASE_PRIVATE_KEY: "must-not-be-used",
      }),
    ).toEqual({
      apiKey: "public-browser-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "web-app-id",
    });
  });

  it.each([
    "VITE_FIREBASE_BROWSER_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_APP_ID",
  ])("fails closed when %s is missing", (missing) => {
    const environment: Record<string, string | undefined> = {
      VITE_FIREBASE_BROWSER_KEY: "public-browser-key",
      VITE_FIREBASE_AUTH_DOMAIN: "project.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "project-id",
      VITE_FIREBASE_APP_ID: "web-app-id",
    };
    delete environment[missing];

    expect(() => readFirebaseOptions(environment)).toThrow(
      SafeAuthenticationError,
    );
  });

  it.each([
    "http://127.0.0.1:9099",
    "http://localhost:9099",
  ])("allows the explicitly configured local Auth emulator %s", (value) => {
    expect(
      readFirebaseAuthEmulatorUrl({
        VITE_FIREBASE_AUTH_EMULATOR_URL: value,
      }),
    ).toBe(`${value}/`);
  });

  it("keeps the cloud configuration disconnected from an emulator", () => {
    expect(readFirebaseAuthEmulatorUrl({})).toBeUndefined();
  });

  it.each([
    "https://127.0.0.1:9099",
    "http://auth-emulator:9099",
    "http://example.test:9099",
    "not-a-url",
  ])("rejects an unsafe Auth emulator URL %s", (value) => {
    expect(() =>
      readFirebaseAuthEmulatorUrl({
        VITE_FIREBASE_AUTH_EMULATOR_URL: value,
      }),
    ).toThrow(SafeAuthenticationError);
  });

  it.each([
    ["https://app.example.test", "https://app.example.test/"],
    ["http://127.0.0.1:18080", "http://127.0.0.1:18080/"],
    ["http://localhost:5173", "http://localhost:5173/"],
  ])("creates a safe verification return URL from %s", (origin, expected) => {
    expect(readFirebaseVerificationActionUrl(origin)).toBe(expected);
  });

  it.each([
    "http://app.example.test",
    "https://user:password@app.example.test",
    "https://app.example.test/path",
    "not-a-url",
  ])("rejects an unsafe verification return URL %s", (origin) => {
    expect(() => readFirebaseVerificationActionUrl(origin)).toThrow(
      SafeAuthenticationError,
    );
  });

  it("retrieves only the matching local email verification link", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          oobCodes: [
            {
              email: "other@example.test",
              requestType: "VERIFY_EMAIL",
              oobLink:
                "http://127.0.0.1:9099/emulator/action?mode=verifyEmail&oobCode=other",
            },
            {
              email: "person@example.test",
              requestType: "PASSWORD_RESET",
              oobLink:
                "http://127.0.0.1:9099/emulator/action?mode=resetPassword&oobCode=reset",
            },
            {
              email: "person@example.test",
              requestType: "VERIFY_EMAIL",
              oobLink:
                "http://127.0.0.1:9099/emulator/action?mode=verifyEmail&oobCode=verified",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      fetchEmulatorVerificationDelivery(
        "http://127.0.0.1:9099/",
        "demo-project",
        "person@example.test",
        fetcher,
      ),
    ).resolves.toEqual({
      kind: "emulator",
      actionUrl:
        "http://127.0.0.1:9099/emulator/action?mode=verifyEmail&oobCode=verified",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9099/emulator/v1/projects/demo-project/oobCodes",
      { headers: { accept: "application/json" } },
    );
  });

  it.each([
    new Response("unavailable", { status: 503 }),
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({ oobCodes: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response(
      JSON.stringify({
        oobCodes: [
          {
            email: "person@example.test",
            requestType: "VERIFY_EMAIL",
            oobLink:
              "https://attacker.example/emulator/action?mode=verifyEmail&oobCode=leak",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ])("fails safely when a local verification link is unavailable", async (response) => {
    await expect(
      fetchEmulatorVerificationDelivery(
        "http://127.0.0.1:9099/",
        "demo-project",
        "person@example.test",
        vi.fn<typeof fetch>().mockResolvedValue(response),
      ),
    ).resolves.toEqual({ kind: "emulator" });
  });
});
