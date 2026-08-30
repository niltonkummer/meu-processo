import { createHash } from "node:crypto";

import { decodeHTML } from "entities";

import { normalizeTarget } from "../domain/search-target.js";
import type {
  DjenClient,
  DjenPublication,
  ProcessAggregate,
  SearchPublication,
  SearchResponse,
} from "./types.js";

const normalizeCnj = (value: string | undefined) => {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length !== 20) return undefined;
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
};

const decodeRepeatedHtmlEntities = (value: string) =>
  Array.from({ length: 3 }).reduce<string>(
    (decoded) => decodeHTML(decoded),
    value,
  );

const toPlainText = (value: string | undefined) =>
  decodeRepeatedHtmlEntities(value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);

const hasSafeDocumentLink = (value: string | undefined) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

const publicationKey = (publication: DjenPublication) => {
  if (publication.id !== undefined) return `id:${String(publication.id)}`;
  return createHash("sha256")
    .update(
      JSON.stringify([
        publication.numeroProcesso,
        publication.dataDisponibilizacao,
        publication.tribunal,
        publication.orgao,
        publication.texto,
      ]),
    )
    .digest("hex");
};

const toSearchPublication = (
  publication: DjenPublication,
  key: string,
): SearchPublication => {
  const result: SearchPublication = {
    id: publication.id === undefined ? key : String(publication.id),
    summary: toPlainText(publication.texto),
  };
  if (publication.dataDisponibilizacao)
    result.availableAt = publication.dataDisponibilizacao;
  if (publication.orgao) result.organ = publication.orgao;
  if (publication.classe) result.className = publication.classe;
  if (publication.tipoComunicacao)
    result.communicationType = publication.tipoComunicacao;
  if (publication.meio) result.medium = publication.meio;
  if (publication.tipoDocumento)
    result.documentType = publication.tipoDocumento;
  if (publication.numeroComunicacao !== undefined)
    result.communicationNumber = publication.numeroComunicacao;
  if (
    publication.numeroComunicacao !== undefined &&
    hasSafeDocumentLink(publication.link)
  ) {
    result.documentAvailable = true;
  }
  return result;
};

export const compareOptionalDatesDescending = (
  left: string | undefined,
  right: string | undefined,
) => (right ?? "").localeCompare(left ?? "");

const sortDateDescending = (
  left: { availableAt?: string },
  right: { availableAt?: string },
) => compareOptionalDatesDescending(left.availableAt, right.availableAt);

const buildAggregate = (
  cnjNumber: string,
  publications: Array<{ raw: DjenPublication; key: string }>,
): ProcessAggregate => {
  const mapped = publications
    .map(({ raw, key }) => toSearchPublication(raw, key))
    .sort(sortDateDescending);
  const latestRaw = publications
    .map(({ raw }) => raw)
    .sort((left, right) =>
      compareOptionalDatesDescending(
        left.dataDisponibilizacao,
        right.dataDisponibilizacao,
      ),
    )[0];

  const aggregate: ProcessAggregate = {
    cnjNumber,
    publicationCount: mapped.length,
    publications: mapped,
  };
  if (latestRaw?.tribunal) aggregate.tribunal = latestRaw.tribunal;
  if (latestRaw?.orgao) aggregate.organ = latestRaw.orgao;
  if (latestRaw?.classe) aggregate.className = latestRaw.classe;
  if (mapped[0]?.availableAt) aggregate.lastPublicationAt = mapped[0].availableAt;
  return aggregate;
};

export const searchProcesses = async (
  input: unknown,
  client: DjenClient,
): Promise<SearchResponse> => {
  const target = normalizeTarget(input);
  const upstreamResults = await Promise.all(
    target.queries.map((query) => client.search(query)),
  );

  const deduplicated = new Map<
    string,
    { raw: DjenPublication; key: string }
  >();
  for (const result of upstreamResults) {
    for (const raw of result.publications) {
      const key = publicationKey(raw);
      if (!deduplicated.has(key)) deduplicated.set(key, { raw, key });
    }
  }

  const grouped = new Map<
    string,
    Array<{ raw: DjenPublication; key: string }>
  >();
  let ungroupedPublications = 0;
  for (const item of deduplicated.values()) {
    const cnjNumber = normalizeCnj(item.raw.numeroProcesso);
    if (!cnjNumber) {
      ungroupedPublications += 1;
      continue;
    }
    const group = grouped.get(cnjNumber) ?? [];
    group.push(item);
    grouped.set(cnjNumber, group);
  }

  const processes = [...grouped.entries()]
    .map(([cnjNumber, publications]) =>
      buildAggregate(cnjNumber, publications),
    )
    .sort((left, right) =>
      compareOptionalDatesDescending(
        left.lastPublicationAt,
        right.lastPublicationAt,
      ),
    );

  const warnings =
    target.type === "name"
      ? [
          "Resultados por nome podem incluir homônimos e não representam cobertura nacional completa.",
        ]
      : [
          `O DJEN não oferece filtro próprio por ${target.type.toUpperCase()}; esta busca experimental só encontra o documento quando ele aparece literalmente no texto da publicação.`,
        ];

  return {
    target: {
      id: target.id,
      type: target.type,
      displayValue: target.displayValue,
    },
    source: {
      id: "DJEN",
      official: true,
      strategy: target.strategy,
      confidence: target.confidence,
    },
    summary: {
      publications: deduplicated.size,
      processes: processes.length,
      ungroupedPublications,
      truncated: upstreamResults.some((result) => result.truncated),
    },
    processes,
    warnings,
  };
};
