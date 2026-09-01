export type DocumentAccessClass = "public_official" | "restricted" | "unknown";
export type DocumentAvailabilityStatus =
  | "metadata_only"
  | "available"
  | "expired"
  | "unavailable";

export interface PersistedCaseDocument {
  readonly documentId: string;
  readonly caseId: string;
  readonly caseEventId: string | null;
  readonly title: string;
  readonly documentType: string | null;
  readonly accessClass: DocumentAccessClass;
  readonly availabilityStatus: DocumentAvailabilityStatus;
  readonly expectedMediaType: "application/pdf";
  readonly sourceCreatedAt: string;
  readonly lastVerifiedAt: string;
  readonly source: { readonly sourceId: string; readonly official: boolean };
  readonly artifact: null | {
    readonly artifactId: string;
    readonly mediaType: "application/pdf";
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly expiresAt: string;
  };
}

export type DocumentMaterializationState =
  | "queued"
  | "processing"
  | "available";

export interface DocumentMaterializationResult {
  readonly materializationId: string;
  readonly documentId: string;
  readonly state: DocumentMaterializationState;
}

export class SafePersistedDocumentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SafePersistedDocumentError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{8,512}$/;
const SOURCE_ID = /^[A-Za-z0-9._:-]{2,64}$/;
const DOCUMENT_TYPE = /^[a-z][a-z0-9_.-]{1,63}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const DOCUMENT_KEYS = new Set([
  "documentId", "caseId", "caseEventId", "title", "documentType",
  "accessClass", "availabilityStatus", "expectedMediaType",
  "sourceCreatedAt", "lastVerifiedAt", "source", "artifact",
]);
const SOURCE_KEYS = new Set(["sourceId", "official"]);
const ARTIFACT_KEYS = new Set([
  "artifactId", "mediaType", "sizeBytes", "sha256", "expiresAt",
]);
const MATERIALIZATION_KEYS = new Set([
  "materializationId", "documentId", "state",
]);

const invalidResponse = () => new SafePersistedDocumentError(
  "INVALID_RESPONSE", "O servidor retornou documentos inesperados.",
);
const invalidRequest = () => new SafePersistedDocumentError(
  "INVALID_REQUEST", "Não foi possível montar a consulta de documentos.",
);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Record<string, unknown>;
};
const exact = (record: Record<string, unknown>, keys: Set<string>) =>
  Object.keys(record).length === keys.size &&
  Object.keys(record).every((key) => keys.has(key));
const asDate = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseArtifact = (value: unknown) => {
  if (value === null) return null;
  const record = asRecord(value);
  if (!exact(record, ARTIFACT_KEYS) ||
      typeof record.artifactId !== "string" || !UUID.test(record.artifactId) ||
      record.mediaType !== "application/pdf" ||
      !Number.isInteger(record.sizeBytes) || Number(record.sizeBytes) < 1 ||
      Number(record.sizeBytes) > 104857600 ||
      typeof record.sha256 !== "string" || !SHA256.test(record.sha256) ||
      !asDate(record.expiresAt)) throw invalidResponse();
  return record as unknown as NonNullable<PersistedCaseDocument["artifact"]>;
};

const parseDocument = (value: unknown, caseId: string): PersistedCaseDocument => {
  const record = asRecord(value);
  const sourceCreatedAt = asDate(record.sourceCreatedAt);
  const lastVerifiedAt = asDate(record.lastVerifiedAt);
  if (!exact(record, DOCUMENT_KEYS) ||
      typeof record.documentId !== "string" || !UUID.test(record.documentId) ||
      record.caseId !== caseId ||
      (record.caseEventId !== null &&
        (typeof record.caseEventId !== "string" || !UUID.test(record.caseEventId))) ||
      typeof record.title !== "string" || record.title.length < 1 ||
      record.title.length > 200 ||
      (record.documentType !== null &&
        (typeof record.documentType !== "string" || !DOCUMENT_TYPE.test(record.documentType))) ||
      !["public_official", "restricted", "unknown"].includes(String(record.accessClass)) ||
      !["metadata_only", "available", "expired", "unavailable"].includes(String(record.availabilityStatus)) ||
      record.expectedMediaType !== "application/pdf" ||
      !sourceCreatedAt || !lastVerifiedAt || lastVerifiedAt < sourceCreatedAt) {
    throw invalidResponse();
  }
  const source = asRecord(record.source);
  if (!exact(source, SOURCE_KEYS) || typeof source.sourceId !== "string" ||
      !SOURCE_ID.test(source.sourceId) || typeof source.official !== "boolean") {
    throw invalidResponse();
  }
  const artifact = parseArtifact(record.artifact);
  if (artifact && record.availabilityStatus !== "available") throw invalidResponse();
  return {
    documentId: record.documentId,
    caseId,
    caseEventId: record.caseEventId,
    title: record.title,
    documentType: record.documentType,
    accessClass: record.accessClass as DocumentAccessClass,
    availabilityStatus: record.availabilityStatus as DocumentAvailabilityStatus,
    expectedMediaType: "application/pdf",
    sourceCreatedAt: record.sourceCreatedAt as string,
    lastVerifiedAt: record.lastVerifiedAt as string,
    source: source as unknown as PersistedCaseDocument["source"],
    artifact,
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  try { return await response.json(); }
  catch { throw invalidResponse(); }
};
const throwApiError = (value: unknown): never => {
  const fallback = new SafePersistedDocumentError(
    "DOCUMENTS_FAILED", "Não foi possível carregar os documentos.",
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw fallback;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || record.code.length < 1 ||
      record.code.length > 80 || typeof record.message !== "string" ||
      record.message.length < 1 || record.message.length > 240) throw fallback;
  throw new SafePersistedDocumentError(record.code, record.message);
};
const parseCursor = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !CURSOR.test(value)) throw invalidResponse();
  return value;
};

export const listPersistedDocumentsPage = async (
  fetcher: typeof fetch,
  token: string,
  caseId: string,
  request: { readonly limit: number; readonly cursor?: string },
): Promise<{ readonly items: readonly PersistedCaseDocument[]; readonly nextCursor: string | null }> => {
  if (!UUID.test(caseId) || !Number.isInteger(request.limit) ||
      request.limit < 1 || request.limit > 100 ||
      (request.cursor !== undefined && !CURSOR.test(request.cursor))) {
    throw invalidRequest();
  }
  const cursor = request.cursor ? `&cursor=${encodeURIComponent(request.cursor)}` : "";
  const response = await fetcher(
    `/api/v1/cases/${caseId}/documents?limit=${request.limit}${cursor}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (!exact(record, new Set(["documents", "page"])) ||
      !Array.isArray(record.documents)) throw invalidResponse();
  const page = asRecord(record.page);
  if (!exact(page, new Set(["nextCursor"]))) throw invalidResponse();
  const items = record.documents.map((item) => parseDocument(item, caseId));
  if (new Set(items.map((item) => item.documentId)).size !== items.length) {
    throw invalidResponse();
  }
  return { items, nextCursor: parseCursor(page.nextCursor) };
};

const invalidDownload = () => new SafePersistedDocumentError(
  "INVALID_DOWNLOAD",
  "O arquivo recebido não corresponde ao documento solicitado.",
);

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

export const requestPersistedDocumentMaterialization = async (
  fetcher: typeof fetch,
  token: string,
  caseId: string,
  documentId: string,
): Promise<DocumentMaterializationResult> => {
  if (
    token.length < 1 || token.length > 8192 || hasControlCharacter(token) ||
    !UUID.test(caseId) || !UUID.test(documentId)
  ) throw invalidRequest();
  const response = await fetcher(
    `/api/v1/cases/${caseId}/documents/${documentId}/materializations`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
    },
  );
  const body = await readJson(response);
  if (!response.ok) throwApiError(body);
  const record = asRecord(body);
  if (
    response.status !== 202 || !exact(record, MATERIALIZATION_KEYS) ||
    typeof record.materializationId !== "string" ||
    !UUID.test(record.materializationId) ||
    record.documentId !== documentId ||
    !["queued", "processing", "available"].includes(String(record.state))
  ) throw invalidResponse();
  return record as unknown as DocumentMaterializationResult;
};

export const downloadPersistedDocument = async (
  fetcher: typeof fetch,
  token: string,
  caseId: string,
  documentId: string,
  artifact: { readonly sizeBytes: number; readonly sha256: string },
): Promise<{
  readonly bytes: Uint8Array;
  readonly mediaType: "application/pdf";
  readonly sha256: string;
  readonly fileName: string;
}> => {
  if (token.length < 1 || token.length > 8192 || hasControlCharacter(token) ||
      !UUID.test(caseId) || !UUID.test(documentId) ||
      !Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes < 9 ||
      artifact.sizeBytes > 25 * 1024 * 1024 || !SHA256.test(artifact.sha256)) {
    throw invalidRequest();
  }
  const response = await fetcher(
    `/api/v1/cases/${caseId}/documents/${documentId}/content`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok) throwApiError(await readJson(response));
  const contentLength = Number(response.headers.get("content-length"));
  if (
    response.redirected ||
    response.headers.get("content-type")?.toLowerCase() !== "application/pdf" ||
    !Number.isInteger(contentLength) || contentLength !== artifact.sizeBytes ||
    response.headers.get("x-document-sha256") !== artifact.sha256 ||
    !/^attachment(?:;|$)/i.test(
      response.headers.get("content-disposition") ?? "",
    )
  ) throw invalidDownload();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength !== artifact.sizeBytes ||
    bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 || bytes[4] !== 0x2d
  ) throw invalidDownload();
  return {
    bytes,
    mediaType: "application/pdf",
    sha256: artifact.sha256,
    fileName: `documento-${documentId}.pdf`,
  };
};
