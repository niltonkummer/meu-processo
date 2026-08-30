/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_BROWSER_KEY: string | undefined;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string | undefined;
  readonly VITE_FIREBASE_PROJECT_ID: string | undefined;
  readonly VITE_FIREBASE_APP_ID: string | undefined;
  readonly VITE_FIREBASE_AUTH_EMULATOR_URL: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
