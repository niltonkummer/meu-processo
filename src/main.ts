import { resolve } from "node:path";

import { createAppServer } from "./http/server.js";
import {
  OfficialDjenClient,
  readDjenSearchProxyUrl,
} from "./infrastructure/djen-client.js";
import {
  CloudRunBrowserRendererConnector,
  GoogleCloudIdTokenProvider,
  type IdTokenProvider,
} from "./infrastructure/browser-renderer-connector.js";
import { createFirebaseTokenVerifier } from "./infrastructure/firebase-authentication.js";
import { MemoryRequestRateLimiter } from "./infrastructure/memory-request-rate-limiter.js";
import { SecureDocumentClient } from "./infrastructure/secure-document-client.js";

const authenticationMode = process.env.AUTH_MODE ?? "disabled";
if (!new Set(["disabled", "firebase"]).has(authenticationMode)) {
  throw new Error("AUTH_MODE must be disabled or firebase.");
}

const port = Number(process.env.PORT ?? 8080);
const djenClient = new OfficialDjenClient(
  fetch,
  readDjenSearchProxyUrl(process.env),
);
const rendererEndpoint = process.env.BROWSER_RENDERER_URL;
const rendererAuthenticationMode =
  process.env.BROWSER_RENDERER_AUTH_MODE ?? "google-id-token";
if (!new Set(["google-id-token", "disabled"]).has(rendererAuthenticationMode)) {
  throw new Error(
    "BROWSER_RENDERER_AUTH_MODE must be google-id-token or disabled.",
  );
}
const rendererTokenProvider: IdTokenProvider =
  rendererAuthenticationMode === "disabled"
    ? { getToken: () => Promise.resolve("local-development-only") }
    : new GoogleCloudIdTokenProvider();
const serverOptions = {
  client: djenClient,
  webRoot: resolve("dist/web"),
  publicationLocator: djenClient,
  documentClient: new SecureDocumentClient({
    allowedHosts: ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"],
  }),
  requestRateLimiter: new MemoryRequestRateLimiter(),
  ...(rendererEndpoint
    ? {
        rendererConnector: new CloudRunBrowserRendererConnector({
          endpoint: rendererEndpoint,
          tokenProvider: rendererTokenProvider,
        }),
      }
    : {}),
  ...(authenticationMode === "firebase"
    ? { tokenVerifier: createFirebaseTokenVerifier() }
    : {}),
};
const server = createAppServer(serverOptions);

server.listen(port, "0.0.0.0", () => {
  console.log(`Meu Processo listening on port ${port}`);
});
