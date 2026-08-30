const http = require("node:http");

const port = Number(process.env.PORT || 8080);
const upstreamUrl =
  "https://comunicaapi.pje.jus.br/api/v1/comunicacao/tribunal";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      throw new Error("RequestBodyTooLarge");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function searchDjen(request, response) {
  let input;

  try {
    input = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body",
    });
    return;
  }

  const nomeParte = String(input.nomeParte || "").trim();
  const pagina = Math.max(1, Math.min(100, Number(input.pagina || 1)));
  const itensPorPagina = input.itensPorPagina === 5 ? 5 : 100;

  if (nomeParte.length < 5 || nomeParte.length > 200) {
    sendJson(response, 400, { error: "nomeParte must have 5 to 200 characters" });
    return;
  }

  const query = new URLSearchParams({
    nomeParte,
    pagina: String(pagina),
    itensPorPagina: String(itensPorPagina),
  });

  if (input.dataDisponibilizacaoInicio) {
    query.set(
      "dataDisponibilizacaoInicio",
      String(input.dataDisponibilizacaoInicio),
    );
  }
  if (input.dataDisponibilizacaoFim) {
    query.set(
      "dataDisponibilizacaoFim",
      String(input.dataDisponibilizacaoFim),
    );
  }

  try {
    const upstreamResponse = await fetch(
      `https://comunicaapi.pje.jus.br/api/v1/comunicacao?${query}`,
      {
        headers: {
          accept: "application/json",
          "user-agent": "meu-processo-djen-worker/0.1",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      },
    );

    const body = await upstreamResponse.text();
    response.writeHead(upstreamResponse.status, {
      "content-type": upstreamResponse.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function testDjen(response) {
  const startedAt = Date.now();

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "meu-processo-djen-worker/0.1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    const body = await upstreamResponse.text();
    let parsedBody;

    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = undefined;
    }

    sendJson(response, 200, {
      reachable: true,
      upstreamStatus: upstreamResponse.status,
      upstreamOk: upstreamResponse.ok,
      contentType: upstreamResponse.headers.get("content-type"),
      responseBytes: Buffer.byteLength(body),
      responseShape: Array.isArray(parsedBody)
        ? { type: "array", items: parsedBody.length }
        : parsedBody && typeof parsedBody === "object"
          ? { type: "object", keys: Object.keys(parsedBody).sort() }
          : { type: "non-json" },
      elapsedMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      cloudRunRegion: process.env.CLOUD_RUN_REGION || "unknown",
    });
  } catch (error) {
    sendJson(response, 502, {
      reachable: false,
      error: error instanceof Error ? error.name : "UnknownError",
      elapsedMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      cloudRunRegion: process.env.CLOUD_RUN_REGION || "unknown",
    });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/test-djen") {
    await testDjen(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/search-djen") {
    await searchDjen(request, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Worker listening on port ${port}`);
});
