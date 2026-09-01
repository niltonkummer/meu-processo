import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import type { AuthorizedDocument } from "./document-gateway.js";
import {
  parsePublicationReference,
  PublicationNotFoundError,
  type DjenPublicationLocator,
} from "./publication-proxy.js";
import type { DjenPublication } from "./types.js";

export interface PublicationCopyPdfGenerator {
  generate(publication: DjenPublication): Promise<{
    bytes: Uint8Array;
    mediaType: "application/pdf";
    sha256: string;
  }>;
}

export class PublicationTextUnavailableError extends Error {
  constructor() {
    super("O texto oficial desta publicação não está disponível no DJEN.");
    this.name = "PublicationTextUnavailableError";
  }
}

const cnjDigits = (value: string | undefined): string | undefined => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 20 ? digits : undefined;
};

const formattedCnj = (digits: string): string =>
  `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;

export const createAuthorizedPublicationCopy = async (
  _principal: AuthenticatedPrincipal,
  requestedCnj: string,
  requestedCommunication: string,
  locator: DjenPublicationLocator,
  generator: PublicationCopyPdfGenerator,
): Promise<AuthorizedDocument> => {
  const { cnjNumber, communicationNumber } = parsePublicationReference(
    requestedCnj,
    requestedCommunication,
  );
  const publication = await locator.findCommunication({
    cnjNumber,
    communicationNumber,
  });
  if (
    !publication ||
    cnjDigits(publication.numeroProcesso) !== cnjNumber ||
    publication.numeroComunicacao !== communicationNumber
  ) {
    throw new PublicationNotFoundError();
  }
  if (!publication.texto?.trim()) throw new PublicationTextUnavailableError();

  const generated = await generator.generate(publication);
  return {
    ...generated,
    fileName: `${formattedCnj(cnjNumber)}-comunicacao-${communicationNumber}-publicacao-djen.pdf`,
  };
};
