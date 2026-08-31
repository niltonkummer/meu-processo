import { resolve } from "node:path";

import type { RuntimeConfig } from "../configuration/runtime-config.js";
import { createAppServer } from "../http/server.js";
import { composeFoundation } from "./foundation-composition-root.js";
import {
  CloudRunBrowserRendererConnector,
  GoogleCloudIdTokenProvider,
  type IdTokenProvider,
} from "../infrastructure/browser-renderer-connector.js";
import { OfficialDjenClient } from "../infrastructure/djen-client.js";
import { createFirebaseTokenVerifier } from "../infrastructure/firebase-authentication.js";
import { MemoryRequestRateLimiter } from "../infrastructure/memory-request-rate-limiter.js";
import { SecureDocumentClient } from "../infrastructure/secure-document-client.js";

export const composeApiServer = (config: RuntimeConfig) => {
  const djenClient = new OfficialDjenClient(fetch, config.djenSearchProxyUrl);
  const foundation = composeFoundation(config.foundation, config.documentDelivery);
  const rendererTokenProvider: IdTokenProvider =
    config.browserRendererAuthenticationMode === "disabled"
      ? { getToken: () => Promise.resolve("local-development-only") }
      : new GoogleCloudIdTokenProvider();

  const server = createAppServer({
    client: djenClient,
    webRoot: resolve("dist/web"),
    publicationLocator: djenClient,
    documentClient: new SecureDocumentClient({
      allowedHosts: ["eproc1g.tjrs.jus.br", "eproc2g.tjrs.jus.br"],
    }),
    requestRateLimiter: new MemoryRequestRateLimiter(),
    ...(foundation.monitoringProfiles
      ? { monitoringProfiles: foundation.monitoringProfiles }
      : {}),
    ...(foundation.casePortfolio
      ? { casePortfolio: foundation.casePortfolio }
      : {}),
    ...(foundation.alerts ? { alerts: foundation.alerts } : {}),
    ...(foundation.caseTimeline ? { caseTimeline: foundation.caseTimeline } : {}),
    ...(foundation.caseDocuments ? { caseDocuments: foundation.caseDocuments } : {}),
    ...(foundation.documentDelivery
      ? { documentDelivery: foundation.documentDelivery }
      : {}),
    ...(foundation.documentMaterializationRequests
      ? {
          documentMaterializationRequests:
            foundation.documentMaterializationRequests,
        }
      : {}),
    ...(foundation.accountDataControls
      ? { accountDataControls: foundation.accountDataControls }
      : {}),
    ...(config.browserRendererUrl
      ? {
          rendererConnector: new CloudRunBrowserRendererConnector({
            endpoint: config.browserRendererUrl,
            tokenProvider: rendererTokenProvider,
          }),
        }
      : {}),
    ...(config.authenticationMode === "firebase"
      ? { tokenVerifier: createFirebaseTokenVerifier() }
      : {}),
  });
  server.once("close", () => {
    void foundation.close().catch(() => undefined);
  });
  return server;
};
