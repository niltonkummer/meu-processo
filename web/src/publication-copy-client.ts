const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export class SafePublicationCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafePublicationCopyError";
  }
}

const integrityError = () =>
  new SafePublicationCopyError(
    "A cópia recebida não passou pela validação de integridade.",
  );

const apiErrorMessages: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Sua sessão expirou. Entre novamente para baixar a cópia.",
  RATE_LIMITED: "Muitas tentativas em pouco tempo. Aguarde e tente novamente.",
  SOURCE_RATE_LIMITED: "A fonte oficial atingiu o limite temporário. Tente novamente mais tarde.",
  PUBLICATION_NOT_FOUND: "A publicação não foi reencontrada na fonte oficial.",
  PUBLICATION_TEXT_UNAVAILABLE:
    "O texto oficial desta publicação não está disponível no DJEN.",
  PUBLICATION_COPY_FAILED: "Não foi possível preparar a cópia da publicação.",
  PUBLICATION_SOURCE_UNAVAILABLE: "A fonte oficial não respondeu. Tente novamente mais tarde.",
  PUBLICATION_COPY_UNAVAILABLE: "A cópia da publicação está temporariamente indisponível.",
};

const formattedCnj = (digits: string): string =>
  `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

export const downloadPublicationCopy = async (
  fetcher: typeof fetch,
  token: string,
  cnjNumber: string,
  communicationNumber: number,
  digest: (
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ) => Promise<ArrayBuffer> = (algorithm, data) =>
    crypto.subtle.digest(algorithm, data),
): Promise<{ blob: Blob; fileName: string; sha256: string }> => {
  if (
    token.length === 0 ||
    token.length > 8_192 ||
    !/^\d{20}$/u.test(cnjNumber) ||
    !Number.isSafeInteger(communicationNumber) ||
    communicationNumber <= 0
  ) {
    throw new SafePublicationCopyError("A referência da publicação é inválida.");
  }

  let response: Response;
  try {
    response = await fetcher(
      `/api/v1/processes/${cnjNumber}/communications/${communicationNumber}/publication-copy`,
      {
        method: "GET",
        headers: {
          accept: "application/pdf",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        redirect: "error",
      },
    );
  } catch {
    throw new SafePublicationCopyError(
      "Não foi possível preparar a cópia da publicação.",
    );
  }

  if (!response.ok) {
    let code = "";
    try {
      const payload: unknown = await response.json();
      if (typeof payload === "object" && payload !== null) {
        const candidate = (payload as Record<string, unknown>).code;
        if (typeof candidate === "string") code = candidate;
      }
    } catch {
      // Fail closed without exposing a body controlled by the upstream.
    }
    throw new SafePublicationCopyError(
      apiErrorMessages[code] ?? "Não foi possível preparar a cópia da publicação.",
    );
  }

  const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
  const declaredLength = Number(response.headers.get("content-length"));
  const disposition = response.headers.get("content-disposition") ?? "";
  const expectedHash = response.headers.get("x-document-sha256") ?? "";
  if (
    mediaType !== "application/pdf" ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 5 ||
    declaredLength > MAX_DOCUMENT_BYTES ||
    !/^attachment;/iu.test(disposition) ||
    !/^[a-f0-9]{64}$/u.test(expectedHash)
  ) {
    throw integrityError();
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength !== declaredLength ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
  ) {
    throw integrityError();
  }

  let actualHash: string;
  try {
    actualHash = toHex(await digest("SHA-256", bytes));
  } catch {
    throw integrityError();
  }
  if (actualHash !== expectedHash) throw integrityError();

  return {
    blob: new Blob([bytes], { type: "application/pdf" }),
    fileName: `${formattedCnj(cnjNumber)}-comunicacao-${communicationNumber}-publicacao-djen.pdf`,
    sha256: expectedHash,
  };
};
