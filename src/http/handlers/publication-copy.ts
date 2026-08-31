import {
  createAuthorizedPublicationCopy,
  PublicationTextUnavailableError,
} from "../../application/publication-copy.js";
import {
  parsePublicationReference,
  PublicationNotFoundError,
  PublicationReferenceInvalidError,
} from "../../application/publication-proxy.js";
import {
  DjenRateLimitError,
  DjenUpstreamError,
} from "../../infrastructure/djen-client.js";
import { PublicationCopyGenerationError } from "../../infrastructure/djen-publication-pdf.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  DOCUMENT_RATE_LIMIT,
  RATE_WINDOW_MS,
  sendPrivateDocument,
  sendPrivateJson,
  sendRateLimited,
} from "../transport.js";

export const handlePublicationCopy: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  const segments = pathname.split("/").filter(Boolean);
  const matches =
    request.method === "GET" &&
    segments.length === 7 &&
    segments[0] === "api" &&
    segments[1] === "v1" &&
    segments[2] === "processes" &&
    segments[4] === "communications" &&
    segments[6] === "publication-copy";
  if (!matches) return false;

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }

  if (
    !dependencies.publicationLocator ||
    !dependencies.publicationCopyPdfGenerator ||
    !dependencies.requestRateLimiter
  ) {
    sendPrivateJson(response, 503, {
      code: "PUBLICATION_COPY_UNAVAILABLE",
      message: "A cópia da publicação não está configurada.",
    });
    return true;
  }

  const requestedCnj = segments[3] ?? "";
  const requestedCommunication = segments[5] ?? "";
  try {
    parsePublicationReference(requestedCnj, requestedCommunication);
  } catch (error) {
    if (error instanceof PublicationReferenceInvalidError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_PUBLICATION_REFERENCE",
        message: "A referência da publicação é inválida.",
      });
      return true;
    }
    throw error;
  }

  if (
    !dependencies.requestRateLimiter.allow(
      `document:${principal.userId}`,
      DOCUMENT_RATE_LIMIT,
      RATE_WINDOW_MS,
    )
  ) {
    sendRateLimited(response);
    return true;
  }

  try {
    const document = await createAuthorizedPublicationCopy(
      principal,
      requestedCnj,
      requestedCommunication,
      dependencies.publicationLocator,
      dependencies.publicationCopyPdfGenerator,
    );
    sendPrivateDocument(response, document);
  } catch (error) {
    if (error instanceof PublicationNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "PUBLICATION_NOT_FOUND",
        message: "Publicação não encontrada.",
      });
      return true;
    }
    if (error instanceof PublicationTextUnavailableError) {
      sendPrivateJson(response, 422, {
        code: "PUBLICATION_TEXT_UNAVAILABLE",
        message: "O texto oficial desta publicação não está disponível no DJEN.",
      });
      return true;
    }
    if (error instanceof DjenRateLimitError) {
      sendRateLimited(response, "SOURCE_RATE_LIMITED");
      return true;
    }
    if (error instanceof DjenUpstreamError) {
      sendPrivateJson(response, 502, {
        code: "PUBLICATION_SOURCE_UNAVAILABLE",
        message: "A fonte oficial não respondeu.",
      });
      return true;
    }
    if (error instanceof PublicationCopyGenerationError) {
      sendPrivateJson(response, 502, {
        code: "PUBLICATION_COPY_FAILED",
        message: "Não foi possível gerar a cópia da publicação.",
      });
      return true;
    }
    throw error;
  }
  return true;
};
