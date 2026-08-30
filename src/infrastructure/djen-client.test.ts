import { describe, expect, it, vi } from "vitest";

import {
  DjenRateLimitError,
  DjenUpstreamError,
  OfficialDjenClient,
  readDjenSearchProxyUrl,
} from "./djen-client.js";

describe("OfficialDjenClient", () => {
  it("routes a local name search through the private Brazilian tunnel", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ count: 0, items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new OfficialDjenClient(
      fetcher,
      "http://host.docker.internal:19090/search-djen",
    );

    await expect(
      client.search({ field: "nomeParte", value: "Pessoa Exemplo" }),
    ).resolves.toEqual({ total: 0, truncated: false, publications: [] });

    expect(fetcher).toHaveBeenCalledWith(
      "http://host.docker.internal:19090/search-djen",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          nomeParte: "Pessoa Exemplo",
          pagina: 1,
          itensPorPagina: 100,
        }),
      }),
    );
  });

  it("keeps exact communication resolution on the official endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ count: 0, items: [] }), { status: 200 }),
    );
    const client = new OfficialDjenClient(
      fetcher,
      "http://host.docker.internal:19090/search-djen",
    );

    await client.findCommunication({
      cnjNumber: "00000012320268990001",
      communicationNumber: 98765,
    });

    const requestUrl = fetcher.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") throw new Error("Expected URL string");
    expect(requestUrl).toContain(
      "https://comunicaapi.pje.jus.br/api/v1/comunicacao?",
    );
  });

  it.each([
    "http://host.docker.internal:19090/search-djen",
    "http://127.0.0.1:19090/search-djen",
    "http://localhost:19090/search-djen",
    "https://private-worker.example/search-djen",
  ])("accepts a safe explicitly configured search proxy %s", (value) => {
    expect(readDjenSearchProxyUrl({ DJEN_SEARCH_PROXY_URL: value })).toBe(value);
  });

  it.each([
    "http://private-worker.example/search-djen",
    "http://host.docker.internal:19090/other",
    "http://user:password@host.docker.internal:19090/search-djen",
    "not-a-url",
  ])("rejects an unsafe search proxy %s", (value) => {
    expect(() =>
      readDjenSearchProxyUrl({ DJEN_SEARCH_PROXY_URL: value }),
    ).toThrow("DJEN_SEARCH_PROXY_URL");
  });

  it("keeps direct official access when no proxy is configured", () => {
    expect(readDjenSearchProxyUrl({})).toBeUndefined();
  });

  it("uses the documented DJEN query and maps only known fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 101,
          items: [
            {
              id: 42,
              numero_processo: "0000001-23.2026.8.99.0001",
              siglaTribunal: "TJEX",
              data_disponibilizacao: "2026-08-22",
              nomeOrgao: "Vara de Exemplo",
              nomeClasse: "Classe de Exemplo",
              tipoComunicacao: "Intimação",
              meio: "D",
              meiocompleto: "Diário de Justiça Eletrônico Nacional",
              tipoDocumento: "Despacho",
              numeroComunicacao: 98765,
              texto: "Publicação de teste",
              link: "https://example.test/publicacao/42",
              ignored: "not exposed",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new OfficialDjenClient(fetcher);

    const result = await client.search({
      field: "nomeParte",
      value: "Pessoa Exemplo da Silva",
    });

    const requestUrl = fetcher.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") throw new Error("Expected URL string");
    const calledUrl = new URL(requestUrl);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      "https://comunicaapi.pje.jus.br/api/v1/comunicacao",
    );
    expect(Object.fromEntries(calledUrl.searchParams)).toEqual({
      nomeParte: "Pessoa Exemplo da Silva",
      pagina: "1",
      itensPorPagina: "100",
    });
    expect(result).toEqual({
      total: 101,
      truncated: true,
      publications: [
        {
          id: 42,
          numeroProcesso: "0000001-23.2026.8.99.0001",
          tribunal: "TJEX",
          dataDisponibilizacao: "2026-08-22",
          orgao: "Vara de Exemplo",
          classe: "Classe de Exemplo",
          tipoComunicacao: "Intimação",
          meio: "Diário de Justiça Eletrônico Nacional",
          tipoDocumento: "Despacho",
          numeroComunicacao: 98765,
          texto: "Publicação de teste",
          link: "https://example.test/publicacao/42",
        },
      ],
    });
  });

  it.each([
    ["non-success status", new Response("failure", { status: 503 })],
    ["non-json response", new Response("<html>nope</html>", { status: 200 })],
    ["unexpected shape", new Response(JSON.stringify({ items: "nope" }))],
  ])("rejects a %s", async (_label, response) => {
    const client = new OfficialDjenClient(
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );

    await expect(
      client.search({ field: "texto", value: "12345678909" }),
    ).rejects.toBeInstanceOf(DjenUpstreamError);
  });

  it("re-resolves a communication using both official identifiers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 1,
          items: [
            {
              id: 42,
              numero_processo: "0000001-23.2026.8.99.0001",
              numeroComunicacao: 98765,
              link: "https://eproc1g.tjrs.jus.br/eproc/documento.pdf",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new OfficialDjenClient(fetcher);

    const found = await client.findCommunication({
      cnjNumber: "00000012320268990001",
      communicationNumber: 98765,
    });

    const requestUrl = fetcher.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") throw new Error("Expected URL string");
    expect(Object.fromEntries(new URL(requestUrl).searchParams)).toEqual({
      numeroProcesso: "00000012320268990001",
      numeroComunicacao: "98765",
      pagina: "1",
      itensPorPagina: "5",
    });
    expect(found).toMatchObject({
      id: 42,
      numeroProcesso: "0000001-23.2026.8.99.0001",
      numeroComunicacao: 98765,
    });
  });

  it("returns no communication when the official result is not an exact match", async () => {
    const client = new OfficialDjenClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            count: 1,
            items: [
              {
                numero_processo: "9999999-99.2026.8.99.9999",
                numeroComunicacao: 98765,
                link: "https://eproc1g.tjrs.jus.br/eproc/documento.pdf",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      client.findCommunication({
        cnjNumber: "00000012320268990001",
        communicationNumber: 98765,
      }),
    ).resolves.toBeUndefined();
  });

  it("surfaces the official rate limit without retrying", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "60" },
      }),
    );
    const client = new OfficialDjenClient(fetcher);

    await expect(
      client.search({ field: "nomeParte", value: "Pessoa Exemplo" }),
    ).rejects.toBeInstanceOf(DjenRateLimitError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
