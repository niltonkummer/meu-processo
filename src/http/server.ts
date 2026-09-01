import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import { registerDocumentSessionUpgrade } from "./document-session-upgrade.js";
import { privateRequestHandlers } from "./handlers/index.js";
import type {
  AppServerOptions,
  PrivateApiDependencies,
} from "./private-api.js";
import { applySecurityHeaders, sendJson } from "./transport.js";
import { handleBillingWebhook } from "./handlers/billing-webhook.js";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const serveStatic = (
  pathname: string,
  webRoot: string,
  response: ServerResponse,
) => {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const root = resolve(webRoot);
  const candidate = resolve(join(root, normalize(requested)));
  if (
    !candidate.startsWith(`${root}/`) ||
    !existsSync(candidate) ||
    !statSync(candidate).isFile()
  ) {
    return false;
  }

  applySecurityHeaders(response);
  response.writeHead(200, {
    "content-type": contentTypes[extname(candidate)] ?? "application/octet-stream",
    "cache-control": candidate.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  createReadStream(candidate).pipe(response);
  return true;
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  webRoot: string | undefined,
  privateApi: PrivateApiDependencies,
) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  // Cloud Run reserves the exact external path /healthz, so keep the public
  // health contract on /health even though either path works inside a container.
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (await handleBillingWebhook(request, response, url.pathname, privateApi)) return;

  for (const handler of privateRequestHandlers) {
    if (await handler(request, response, url.pathname, privateApi)) return;
  }

  if (
    request.method === "GET" &&
    webRoot &&
    serveStatic(url.pathname, webRoot, response)
  ) {
    return;
  }

  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "Rota não encontrada.",
  });
};

export const createAppServer = ({
  webRoot,
  ...privateApi
}: AppServerOptions) => {
  const server = createServer((request, response) => {
    void handleRequest(request, response, webRoot, privateApi).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          code: "INTERNAL_ERROR",
          message: "Não foi possível processar a requisição.",
        });
      } else {
        response.destroy();
      }
    });
  });

  registerDocumentSessionUpgrade(server, privateApi);
  return server;
};
