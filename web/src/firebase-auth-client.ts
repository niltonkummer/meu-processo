import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  sendEmailVerification,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";

import {
  SafeAuthenticationError,
  type AuthClient,
  type AuthUser,
  type VerificationDelivery,
} from "./auth-client";

const APP_NAME = "meu-processo-web";

interface FirebaseAuthSetupTarget {
  languageCode: string | null;
}

interface FirebaseAuthSetupDependencies {
  connect(auth: FirebaseAuthSetupTarget, emulatorUrl: string): void;
  persist(auth: FirebaseAuthSetupTarget): Promise<void>;
}

const firebaseAuthSetupDependencies: FirebaseAuthSetupDependencies = {
  connect: (auth, emulatorUrl) =>
    connectAuthEmulator(auth as Auth, emulatorUrl, { disableWarnings: true }),
  persist: (auth) => setPersistence(auth as Auth, inMemoryPersistence),
};

export const configureFirebaseBrowserAuth = async (
  auth: FirebaseAuthSetupTarget,
  emulatorUrl: string | undefined,
  dependencies: FirebaseAuthSetupDependencies = firebaseAuthSetupDependencies,
): Promise<void> => {
  if (emulatorUrl) dependencies.connect(auth, emulatorUrl);
  auth.languageCode = "pt-BR";
  await dependencies.persist(auth);
};

const required = (value: string | undefined): string => {
  if (!value?.trim()) {
    throw new SafeAuthenticationError(
      "A autenticação não está disponível neste ambiente.",
    );
  }
  return value;
};

export const readFirebaseOptions = (
  environment: Record<string, string | undefined>,
): FirebaseOptions => ({
  apiKey: required(environment.VITE_FIREBASE_BROWSER_KEY),
  authDomain: required(environment.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required(environment.VITE_FIREBASE_PROJECT_ID),
  appId: required(environment.VITE_FIREBASE_APP_ID),
});

export const readFirebaseAuthEmulatorUrl = (
  environment: Record<string, string | undefined>,
): string | undefined => {
  const configured = environment.VITE_FIREBASE_AUTH_EMULATOR_URL?.trim();
  if (!configured) return undefined;

  try {
    const url = new URL(configured);
    const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isPlainLocalOrigin =
      url.protocol === "http:" &&
      isLoopback &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "";
    if (isPlainLocalOrigin) return url.toString();
  } catch {
    // Invalid URLs fail closed below.
  }

  throw new SafeAuthenticationError(
    "A autenticação não está disponível neste ambiente.",
  );
};

export const readFirebaseVerificationActionUrl = (origin: string): string => {
  try {
    const url = new URL(origin);
    const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const safeProtocol = url.protocol === "https:" || (url.protocol === "http:" && isLoopback);
    const isOriginOnly =
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "";
    if (safeProtocol && isOriginOnly) return `${url.origin}/`;
  } catch {
    // Invalid origins fail closed below.
  }

  throw new SafeAuthenticationError(
    "A autenticação não está disponível neste ambiente.",
  );
};

export const fetchEmulatorVerificationDelivery = async (
  emulatorUrl: string,
  projectId: string,
  email: string,
  fetcher: typeof fetch = fetch,
): Promise<VerificationDelivery> => {
  const fallback: VerificationDelivery = { kind: "emulator" };
  try {
    const endpoint = new URL(
      `emulator/v1/projects/${encodeURIComponent(projectId)}/oobCodes`,
      emulatorUrl,
    ).toString();
    const response = await fetcher(endpoint, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return fallback;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return fallback;
    const codes = (body as Record<string, unknown>).oobCodes;
    if (!Array.isArray(codes)) return fallback;

    const codeValues = codes as unknown[];
    for (let index = codeValues.length - 1; index >= 0; index -= 1) {
      const value = codeValues[index];
      if (typeof value !== "object" || value === null) continue;
      const record = value as Record<string, unknown>;
      if (
        record.email !== email ||
        record.requestType !== "VERIFY_EMAIL" ||
        typeof record.oobLink !== "string"
      ) {
        continue;
      }
      const link = new URL(record.oobLink);
      const emulatorOrigin = new URL(emulatorUrl).origin;
      const isExpectedAction =
        link.origin === emulatorOrigin &&
        link.pathname === "/emulator/action" &&
        link.username === "" &&
        link.password === "" &&
        link.searchParams.get("mode") === "verifyEmail" &&
        Boolean(link.searchParams.get("oobCode"));
      if (isExpectedAction) {
        return { kind: "emulator", actionUrl: link.toString() };
      }
    }
  } catch {
    // The local confirmation link is convenience only; never weaken cloud auth.
  }
  return fallback;
};

export const mapFirebaseProviderError = (
  error: unknown,
  emulatorEnabled: boolean,
): SafeAuthenticationError => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "auth/too-many-requests") {
    return new SafeAuthenticationError(
      "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    );
  }
  if (code === "auth/weak-password") {
    return new SafeAuthenticationError(
      "Use uma senha mais forte, com pelo menos 12 caracteres.",
    );
  }
  if (emulatorEnabled) {
    const localMessages: Record<string, string> = {
      "auth/network-request-failed":
        "O navegador não conseguiu acessar a autenticação local em 127.0.0.1:9099.",
      "auth/emulator-config-failed":
        "A autenticação local não foi conectada corretamente. Atualize a página e tente novamente.",
      "auth/email-already-in-use":
        "Esta conta de teste já existe. Use Entrar ou reinicie o ambiente local.",
      "auth/operation-not-allowed":
        "O cadastro por e-mail não está habilitado na autenticação local.",
      "auth/invalid-api-key":
        "A configuração pública da autenticação local é inválida.",
      "auth/app-not-authorized":
        "A configuração pública da autenticação local é inválida.",
    };
    const knownMessage = localMessages[code];
    if (knownMessage) return new SafeAuthenticationError(knownMessage);

    const safeCategory = code
      .toLowerCase()
      .replace(/[^a-z0-9/-]/g, "")
      .slice(0, 80) || "auth/unknown";
    return new SafeAuthenticationError(
      `Falha na autenticação local (categoria: ${safeCategory}).`,
    );
  }
  return new SafeAuthenticationError(
    "Não foi possível autenticar com os dados informados.",
  );
};

const toAuthUser = (
  user: User,
  sendVerification: () => Promise<VerificationDelivery>,
  verificationDelivery?: VerificationDelivery,
): AuthUser => {
  if (!user.email) {
    throw new SafeAuthenticationError(
      "A conta não possui um e-mail válido.",
    );
  }
  return {
    email: user.email,
    emailVerified: user.emailVerified,
    ...(verificationDelivery ? { verificationDelivery } : {}),
    getIdToken: () => user.getIdToken(),
    sendVerification,
  };
};

class FirebaseBrowserAuthClient implements AuthClient {
  constructor(
    private readonly auth: Auth,
    private readonly verificationActionUrl: string,
    private readonly emulatorUrl: string | undefined,
    private readonly projectId: string,
  ) {}

  private async sendVerification(user: User): Promise<VerificationDelivery> {
    await sendEmailVerification(user, {
      url: this.verificationActionUrl,
      handleCodeInApp: false,
    });
    if (!this.emulatorUrl || !user.email) return { kind: "email" };
    return fetchEmulatorVerificationDelivery(
      this.emulatorUrl,
      this.projectId,
      user.email,
    );
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    try {
      const credential = await signInWithEmailAndPassword(
        this.auth,
        email,
        password,
      );
      return toAuthUser(
        credential.user,
        () => this.sendVerification(credential.user),
      );
    } catch (error) {
      throw mapFirebaseProviderError(error, Boolean(this.emulatorUrl));
    }
  }

  async signUp(email: string, password: string): Promise<AuthUser> {
    try {
      const credential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        password,
      );
      const delivery = await this.sendVerification(credential.user);
      return toAuthUser(
        credential.user,
        () => this.sendVerification(credential.user),
        delivery,
      );
    } catch (error) {
      throw mapFirebaseProviderError(error, Boolean(this.emulatorUrl));
    }
  }

  signOut(): Promise<void> {
    return firebaseSignOut(this.auth);
  }
}

let clientPromise: Promise<AuthClient> | undefined;

export const createFirebaseAuthClient = (): Promise<AuthClient> => {
  clientPromise ??= (async () => {
    const options = readFirebaseOptions(import.meta.env);
    const projectId = required(options.projectId);
    const app = getApps().some((candidate) => candidate.name === APP_NAME)
      ? getApp(APP_NAME)
      : initializeApp(options, APP_NAME);
    const auth = getAuth(app);
    const emulatorUrl = readFirebaseAuthEmulatorUrl(import.meta.env);
    await configureFirebaseBrowserAuth(auth, emulatorUrl);
    return new FirebaseBrowserAuthClient(
      auth,
      readFirebaseVerificationActionUrl(window.location.origin),
      emulatorUrl,
      projectId,
    );
  })();
  return clientPromise;
};
