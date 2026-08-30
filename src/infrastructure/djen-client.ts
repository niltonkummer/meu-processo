import type {
  DjenClient,
  DjenPublication,
  DjenSearchResult,
} from "../application/types.js";
import type { DjenPublicationLocator } from "../application/publication-proxy.js";

const DJEN_ENDPOINT = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

export const readDjenSearchProxyUrl = (
  environment: Record<string, string | undefined>,
): string | undefined => {
  const configured = environment.DJEN_SEARCH_PROXY_URL?.trim();
  if (!configured) return undefined;

  try {
    const url = new URL(configured);
    const localHosts = new Set([
      "127.0.0.1",
      "localhost",
      "host.docker.internal",
    ]);
    const safeProtocol =
      url.protocol === "https:" ||
      (url.protocol === "http:" && localHosts.has(url.hostname));
    const safeShape =
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/search-djen" &&
      url.search === "" &&
      url.hash === "";
    if (safeProtocol && safeShape) return url.toString();
  } catch {
    // Invalid proxy configuration fails closed below.
  }

  throw new Error("DJEN_SEARCH_PROXY_URL must be a safe search-djen endpoint.");
};

export class DjenUpstreamError extends Error {
  constructor() {
    super("DJEN source unavailable");
    this.name = "DjenUpstreamError";
  }
}

export class DjenRateLimitError extends DjenUpstreamError {
  constructor() {
    super();
    this.name = "DjenRateLimitError";
  }
}

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

const optionalNumber = (value: unknown) =>
  typeof value === "number" ? value : undefined;

const mapPublication = (value: unknown): DjenPublication => {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const result: DjenPublication = {};
  if (typeof raw.id === "string" || typeof raw.id === "number") result.id = raw.id;

  const fields = {
    numeroProcesso: optionalString(raw.numero_processo),
    tribunal: optionalString(raw.siglaTribunal),
    dataDisponibilizacao: optionalString(raw.data_disponibilizacao),
    orgao: optionalString(raw.nomeOrgao),
    classe: optionalString(raw.nomeClasse),
    tipoComunicacao: optionalString(raw.tipoComunicacao),
    meio: optionalString(raw.meiocompleto) ?? optionalString(raw.meio),
    tipoDocumento: optionalString(raw.tipoDocumento),
    numeroComunicacao: optionalNumber(raw.numeroComunicacao),
    texto: optionalString(raw.texto),
    link: optionalString(raw.link),
  };
  for (const [key, fieldValue] of Object.entries(fields)) {
    if (fieldValue !== undefined) {
      (result as Record<string, unknown>)[key] = fieldValue;
    }
  }
  return result;
};

const cnjDigits = (value: string | undefined): string | undefined => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 20 ? digits : undefined;
};

export class OfficialDjenClient implements DjenClient, DjenPublicationLocator {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly searchProxyUrl?: string,
  ) {}

  async search(query: {
    field: "nomeParte" | "texto";
    value: string;
  }): Promise<DjenSearchResult> {
    if (this.searchProxyUrl && query.field === "nomeParte") {
      return this.requestProxy(query.value);
    }
    return this.request(
      new URLSearchParams({
      [query.field]: query.value,
      pagina: "1",
      itensPorPagina: "100",
      }),
    );
  }

  private async requestProxy(value: string): Promise<DjenSearchResult> {
    try {
      const response = await this.fetcher(this.searchProxyUrl!, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "meu-processo/0.1 (+consulta-djen)",
        },
        body: JSON.stringify({
          nomeParte: value,
          pagina: 1,
          itensPorPagina: 100,
        }),
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      return await this.mapResponse(response);
    } catch (error) {
      if (error instanceof DjenUpstreamError) throw error;
      throw new DjenUpstreamError();
    }
  }

  async findCommunication(query: {
    cnjNumber: string;
    communicationNumber: number;
  }): Promise<DjenPublication | undefined> {
    const result = await this.request(
      new URLSearchParams({
        numeroProcesso: query.cnjNumber,
        numeroComunicacao: String(query.communicationNumber),
        pagina: "1",
        itensPorPagina: "5",
      }),
    );

    return result.publications.find(
      (publication) =>
        cnjDigits(publication.numeroProcesso) === query.cnjNumber &&
        publication.numeroComunicacao === query.communicationNumber,
    );
  }

  private async request(parameters: URLSearchParams): Promise<DjenSearchResult> {
    try {
      const response = await this.fetcher(`${DJEN_ENDPOINT}?${parameters}`, {
        headers: {
          accept: "application/json",
          "user-agent": "meu-processo/0.1 (+consulta-djen)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      return await this.mapResponse(response);
    } catch (error) {
      if (error instanceof DjenUpstreamError) throw error;
      throw new DjenUpstreamError();
    }
  }

  private async mapResponse(response: Response): Promise<DjenSearchResult> {
    if (response.status === 429) throw new DjenRateLimitError();
    if (!response.ok) throw new DjenUpstreamError();

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new DjenUpstreamError();
    const record = body as Record<string, unknown>;
    if (!Array.isArray(record.items)) throw new DjenUpstreamError();

    const total =
      typeof record.count === "number" ? record.count : record.items.length;
    return {
      total,
      truncated: total > record.items.length,
      publications: record.items.map(mapPublication),
    };
  }
}
