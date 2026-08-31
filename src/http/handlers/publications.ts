import {
  completeAuthorizedPublicationChallenge,
  openAuthorizedPublication,
  parsePublicationReference,
  PublicationChallengeUnavailableError,
  PublicationNotFoundError,
  PublicationReferenceInvalidError,
} from "../../application/publication-proxy.js";
import { TargetValidationError } from "../../domain/search-target.js";
import { DjenRateLimitError } from "../../infrastructure/djen-client.js";
import {
  DocumentChallengeAnswerInvalidError,
  DocumentChallengeExpiredError,
  DocumentChallengeRequiredError,
  DocumentSourceRejectedError,
} from "../../infrastructure/secure-document-client.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  DOCUMENT_RATE_LIMIT,
  RATE_WINDOW_MS,
  readJsonBody,
  sendPrivateDocument,
  sendPrivateJson,
  sendRateLimited,
} from "../transport.js";

export const handlePublicationProxy: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  const segments = pathname.split("/").filter(Boolean);
  const isInitialRequest =
    request.method === "GET" &&
    segments.length === 7 &&
    segments[0] === "api" &&
    segments[1] === "v1" &&
    segments[2] === "processes" &&
    segments[4] === "communications" &&
    segments[6] === "document";
  const isChallengeResponse =
    request.method === "POST" &&
    segments.length === 8 &&
    segments[0] === "api" &&
    segments[1] === "v1" &&
    segments[2] === "processes" &&
    segments[4] === "communications" &&
    segments[6] === "document" &&
    segments[7] === "challenge";
  if (!isInitialRequest && !isChallengeResponse) return false;

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
    !dependencies.documentClient ||
    !dependencies.requestRateLimiter
  ) {
    sendPrivateJson(response, 503, {
      code: "PUBLICATION_PROXY_UNAVAILABLE",
      message: "O proxy de publicações não está configurado.",
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
    let document;
    if (isChallengeResponse) {
      if (
        !request.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        sendPrivateJson(response, 415, {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Envie o código como application/json.",
        });
        return true;
      }
      const body = await readJsonBody(request);
      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as Record<string, unknown>).challengeId !== "string" ||
        typeof (body as Record<string, unknown>).answer !== "string"
      ) {
        sendPrivateJson(response, 400, {
          code: "INVALID_CHALLENGE_REQUEST",
          message: "Informe o identificador e o código de segurança.",
        });
        return true;
      }
      const challengeBody = body as { challengeId: string; answer: string };
      document = await completeAuthorizedPublicationChallenge(
        principal,
        requestedCnj,
        requestedCommunication,
        challengeBody,
        dependencies.publicationLocator,
        dependencies.documentClient,
      );
    } else {
      document = await openAuthorizedPublication(
        principal,
        requestedCnj,
        requestedCommunication,
        dependencies.publicationLocator,
        dependencies.documentClient,
      );
    }
    sendPrivateDocument(response, document);
  } catch (error) {
    if (error instanceof PublicationNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "PUBLICATION_NOT_FOUND",
        message: "Publicação não encontrada.",
      });
      return true;
    }
    if (error instanceof DjenRateLimitError) {
      sendRateLimited(response, "SOURCE_RATE_LIMITED");
      return true;
    }
    if (error instanceof DocumentChallengeRequiredError) {
      sendPrivateJson(response, 409, {
        code: "DOCUMENT_CHALLENGE_REQUIRED",
        message: "Digite o código exibido pelo tribunal para continuar.",
        challenge: {
          challengeId: error.challengeId,
          imageDataUrl: error.imageDataUrl,
          expiresAt: error.expiresAt,
        },
      });
      return true;
    }
    if (error instanceof DocumentChallengeExpiredError) {
      sendPrivateJson(response, 410, {
        code: "DOCUMENT_CHALLENGE_EXPIRED",
        message: "O código expirou. Solicite uma nova imagem.",
      });
      return true;
    }
    if (error instanceof DocumentChallengeAnswerInvalidError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_CHALLENGE_ANSWER",
        message: "Use apenas letras e números no código de segurança.",
      });
      return true;
    }
    if (error instanceof PublicationChallengeUnavailableError) {
      sendPrivateJson(response, 503, {
        code: "DOCUMENT_CHALLENGE_UNAVAILABLE",
        message: "O fluxo assistido não está disponível.",
      });
      return true;
    }
    if (error instanceof TargetValidationError && isChallengeResponse) {
      sendPrivateJson(response, 400, {
        code: "INVALID_CHALLENGE_REQUEST",
        message: "Não foi possível ler o código de segurança.",
      });
      return true;
    }
    console.error(
      JSON.stringify({
        severity: "WARNING",
        event: "publication_proxy_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof DocumentSourceRejectedError
          ? {
              errorReason: error.reason,
              ...(error.safeContext ? { safeContext: error.safeContext } : {}),
            }
          : {}),
      }),
    );
    sendPrivateJson(response, 502, {
      code: "PUBLICATION_SOURCE_UNAVAILABLE",
      message: "A publicação não pôde ser obtida da fonte oficial.",
    });
  }
  return true;
};
