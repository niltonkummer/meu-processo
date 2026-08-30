import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import type {
  DocumentClient,
  DocumentChallengeAnswer,
  DocumentReference,
  AuthorizedDocument,
} from "./document-gateway.js";
import type { DjenPublication } from "./types.js";

export interface DjenPublicationLocator {
  findCommunication(query: {
    cnjNumber: string;
    communicationNumber: number;
  }): Promise<DjenPublication | undefined>;
}

export class PublicationReferenceInvalidError extends Error {
  constructor() {
    super("A referência da publicação é inválida.");
    this.name = "PublicationReferenceInvalidError";
  }
}

export class PublicationNotFoundError extends Error {
  constructor() {
    super("Publicação não encontrada.");
    this.name = "PublicationNotFoundError";
  }
}

export class PublicationChallengeUnavailableError extends Error {
  constructor() {
    super("O fluxo assistido da publicação não está disponível.");
    this.name = "PublicationChallengeUnavailableError";
  }
}

const cnjDigits = (value: string | undefined): string | undefined => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 20 ? digits : undefined;
};

const formattedCnj = (digits: string): string =>
  `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;

const positiveSafeInteger = (value: string): number | undefined => {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
};

export const parsePublicationReference = (
  requestedCnj: string,
  requestedCommunication: string,
): { cnjNumber: string; communicationNumber: number } => {
  if (!/^\d{20}$/.test(requestedCnj)) {
    throw new PublicationReferenceInvalidError();
  }
  const communicationNumber = positiveSafeInteger(requestedCommunication);
  if (communicationNumber === undefined) {
    throw new PublicationReferenceInvalidError();
  }
  return { cnjNumber: requestedCnj, communicationNumber };
};

const exactHttpsUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const resolveAuthorizedPublication = async (
  principal: AuthenticatedPrincipal,
  requestedCnj: string,
  requestedCommunication: string,
  locator: DjenPublicationLocator,
): Promise<{ reference: DocumentReference; fileName: string }> => {
  const { cnjNumber, communicationNumber } = parsePublicationReference(
    requestedCnj,
    requestedCommunication,
  );

  const publication = await locator.findCommunication({
    cnjNumber,
    communicationNumber,
  });
  const sourceUrl = exactHttpsUrl(publication?.link);
  if (
    !publication ||
    cnjDigits(publication.numeroProcesso) !== cnjNumber ||
    publication.numeroComunicacao !== communicationNumber ||
    sourceUrl === undefined
  ) {
    throw new PublicationNotFoundError();
  }

  const fileName = `${formattedCnj(cnjNumber)}-comunicacao-${communicationNumber}.pdf`;
  const reference: DocumentReference = {
    documentId: `communication_${communicationNumber}`,
    caseId: cnjNumber,
    scope: { kind: "personal", userId: principal.userId },
    sourceId: "DJEN",
    title: publication.tipoDocumento ?? "Publicação oficial",
    fileName,
    mediaType: "application/pdf",
    sourceUrl,
    collectedAt: new Date().toISOString(),
  };

  return { reference, fileName };
};

export const openAuthorizedPublication = async (
  principal: AuthenticatedPrincipal,
  requestedCnj: string,
  requestedCommunication: string,
  locator: DjenPublicationLocator,
  documentClient: DocumentClient,
): Promise<AuthorizedDocument> => {
  const { reference, fileName } = await resolveAuthorizedPublication(
    principal,
    requestedCnj,
    requestedCommunication,
    locator,
  );
  const downloaded = await documentClient.download(reference);
  return { ...downloaded, fileName };
};

export const completeAuthorizedPublicationChallenge = async (
  principal: AuthenticatedPrincipal,
  requestedCnj: string,
  requestedCommunication: string,
  challenge: DocumentChallengeAnswer,
  locator: DjenPublicationLocator,
  documentClient: DocumentClient,
): Promise<AuthorizedDocument> => {
  if (!documentClient.completeChallenge) {
    throw new PublicationChallengeUnavailableError();
  }
  const { reference, fileName } = await resolveAuthorizedPublication(
    principal,
    requestedCnj,
    requestedCommunication,
    locator,
  );
  const downloaded = await documentClient.completeChallenge(
    reference,
    challenge,
  );
  return { ...downloaded, fileName };
};
