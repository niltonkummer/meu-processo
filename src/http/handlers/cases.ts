import {
  getAuthorizedCase,
  listAuthorizedCases,
  PortfolioAccessDeniedError,
  PortfolioCaseNotFoundError,
  type CanonicalCase,
} from "../../application/case-portfolio.js";
import {
  downloadAuthorizedDocument,
  listAuthorizedDocuments,
  DocumentNotFoundError,
} from "../../application/document-gateway.js";
import {
  DocumentMaterializationNotFoundError,
  DocumentMaterializationProjectionError,
  DocumentMaterializationRequestValidationError,
} from "../../application/document-materialization-request.js";
import {
  DocumentContentUnavailableError,
  DocumentDeliveryValidationError,
  DocumentDownloadQuotaExceededError,
  PersistedDocumentNotFoundError,
} from "../../application/individual-document-delivery.js";
import {
  CaseDocumentPageValidationError,
  CaseDocumentsNotFoundError,
} from "../../application/persisted-case-documents.js";
import { PersistedCasePageValidationError } from "../../application/persisted-case-portfolio.js";
import {
  CaseTimelineNotFoundError,
  CaseTimelinePageValidationError,
} from "../../application/persisted-case-timeline.js";
import { RequestContextAccessDeniedError } from "../../application/request-context.js";
import { RepositoryAccessDeniedError } from "../../application/foundation-repository.js";
import type { PrivateRequestHandler } from "../private-api.js";
import {
  authenticate,
  createHttpRequestContext,
  DOCUMENT_MATERIALIZATION_RATE_LIMIT,
  RATE_WINDOW_MS,
  sendPrivateDocument,
  sendPrivateJson,
  sendRateLimited,
} from "../transport.js";

const parseCasePortfolioPage = (
  rawUrl: string | undefined,
): { limit: number; afterCaseId?: string } => {
  const parameters = new URL(rawUrl ?? "/", "http://localhost").searchParams;
  const allowed = new Set(["limit", "after"]);
  if (
    [...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)
  ) {
    throw new PersistedCasePageValidationError();
  }
  const limit = Number(parameters.get("limit") ?? "20");
  const after = parameters.get("after");
  const page = { limit, ...(after ? { afterCaseId: after } : {}) };
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (after !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(after))
  ) {
    throw new PersistedCasePageValidationError();
  }
  return page;
};

const projectPublicCaseSummary = (candidate: CanonicalCase) => ({
  caseId: candidate.caseId,
  cnjNumber: candidate.cnjNumber,
  tribunal: candidate.tribunal,
  identityStatus: candidate.identityStatus,
  lastUpdatedAt: candidate.lastUpdatedAt,
  sources: candidate.sources.map(({ sourceId, official, collectedAt }) => ({
    sourceId,
    official,
    collectedAt,
  })),
});

export const handlePrivateCases: PrivateRequestHandler = async (
  request,
  response,
  pathname,
  dependencies,
) => {
  const isCollection = pathname === "/api/v1/cases";
  const pathSegments = pathname.split("/").filter(Boolean);
  const isCaseDetail =
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases";
  const isEvents =
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "events";
  const isDocumentCollection =
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "documents";
  const isDocumentContent =
    pathSegments.length === 7 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "documents" &&
    pathSegments[6] === "content";
  const isDocumentMaterialization =
    pathSegments.length === 7 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "cases" &&
    pathSegments[4] === "documents" &&
    pathSegments[6] === "materializations";
  if (
    ((isDocumentMaterialization && request.method !== "POST") ||
      (!isDocumentMaterialization && request.method !== "GET")) ||
    (!isCollection &&
      !isCaseDetail &&
      !isEvents &&
      !isDocumentCollection &&
      !isDocumentContent &&
      !isDocumentMaterialization)
  ) {
    return false;
  }

  const principal = await authenticate(request, dependencies.tokenVerifier);
  if (!principal) {
    sendPrivateJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "Autenticação necessária.",
    });
    return true;
  }
  if (
    !dependencies.caseRepository &&
    !((isCollection && dependencies.casePortfolio) ||
      (isEvents && dependencies.caseTimeline) ||
      (isDocumentCollection && dependencies.caseDocuments) ||
      isDocumentMaterialization ||
      (isDocumentContent &&
        (dependencies.documentDelivery || dependencies.caseDocuments)))
  ) {
    sendPrivateJson(response, 503, {
      code: "CASE_PORTFOLIO_UNAVAILABLE",
      message: "A carteira processual ainda não está configurada.",
    });
    return true;
  }
  const caseRepository = dependencies.caseRepository;

  let scope;
  try {
    scope = createHttpRequestContext(request, principal).tenantScope;
  } catch (error) {
    if (error instanceof RequestContextAccessDeniedError) {
      sendPrivateJson(response, 403, {
        code: "FORBIDDEN",
        message: "Acesso negado.",
      });
      return true;
    }
    throw error;
  }
  const usesPersistedDelivery =
    isDocumentContent &&
    scope.kind === "personal" &&
    Boolean(dependencies.documentDelivery || dependencies.caseDocuments);
  const usesMaterializationRequest =
    isDocumentMaterialization && scope.kind === "personal";
  try {
    if (isDocumentMaterialization) {
      if (
        scope.kind !== "personal" ||
        !dependencies.documentMaterializationRequests ||
        !dependencies.requestRateLimiter
      ) {
        sendPrivateJson(response, 503, {
          code: "DOCUMENT_MATERIALIZATION_UNAVAILABLE",
          message: "A preparação de documentos ainda não está configurada.",
        });
        return true;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (
        url.search !== "" ||
        request.headers["transfer-encoding"] ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      ) throw new DocumentMaterializationRequestValidationError();
      if (!dependencies.requestRateLimiter.allow(
        `document-materialization:${principal.userId}`,
        DOCUMENT_MATERIALIZATION_RATE_LIMIT,
        RATE_WINDOW_MS,
      )) {
        sendRateLimited(response);
        return true;
      }
      const result = await dependencies.documentMaterializationRequests.request(
        principal.userId,
        pathSegments[3] ?? "",
        pathSegments[5] ?? "",
      );
      sendPrivateJson(response, 202, result);
      return true;
    }
    if (isCollection) {
      if (dependencies.casePortfolio && scope.kind === "personal") {
        const result = await dependencies.casePortfolio.list(
          principal.userId,
          parseCasePortfolioPage(request.url),
        );
        sendPrivateJson(response, 200, {
          cases: result.cases.map(projectPublicCaseSummary),
          page: { nextCursor: result.nextCursor },
        });
        return true;
      }
      if (!caseRepository) {
        sendPrivateJson(response, 503, {
          code: "CASE_PORTFOLIO_UNAVAILABLE",
          message: "A carteira profissional ainda não está configurada.",
        });
        return true;
      }
      const cases = await listAuthorizedCases(principal, scope, caseRepository);
      sendPrivateJson(response, 200, {
        cases: cases.map(projectPublicCaseSummary),
        page: { nextCursor: null },
      });
      return true;
    }

    if (isEvents && dependencies.caseTimeline && scope.kind === "personal") {
      const parameters = new URL(request.url ?? "/", "http://localhost").searchParams;
      const allowed = new Set(["limit", "cursor"]);
      if (
        [...parameters.keys()].some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => parameters.getAll(key).length > 1)
      ) throw new CaseTimelinePageValidationError();
      const limit = Number(parameters.get("limit") ?? "20");
      const cursor = parameters.get("cursor");
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor !== null && !/^[A-Za-z0-9_-]{8,512}$/.test(cursor))
      ) throw new CaseTimelinePageValidationError();
      const result = await dependencies.caseTimeline.list(
        principal.userId,
        pathSegments[3] ?? "",
        { limit, ...(cursor ? { cursor } : {}) },
      );
      sendPrivateJson(response, 200, {
        events: result.items,
        page: { nextCursor: result.nextCursor },
      });
      return true;
    }

    if (
      isDocumentCollection &&
      dependencies.caseDocuments &&
      scope.kind === "personal"
    ) {
      const parameters = new URL(request.url ?? "/", "http://localhost").searchParams;
      const allowed = new Set(["limit", "cursor"]);
      if (
        [...parameters.keys()].some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => parameters.getAll(key).length > 1)
      ) throw new CaseDocumentPageValidationError();
      const limit = Number(parameters.get("limit") ?? "20");
      const cursor = parameters.get("cursor");
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor !== null && !/^[A-Za-z0-9_-]{8,512}$/.test(cursor))
      ) throw new CaseDocumentPageValidationError();
      const result = await dependencies.caseDocuments.list(
        principal.userId,
        pathSegments[3] ?? "",
        { limit, ...(cursor ? { cursor } : {}) },
      );
      sendPrivateJson(response, 200, {
        documents: result.items,
        page: { nextCursor: result.nextCursor },
      });
      return true;
    }

    if (isDocumentContent && usesPersistedDelivery) {
      if (!dependencies.documentDelivery) {
        sendPrivateJson(response, 503, {
          code: "DOCUMENT_DELIVERY_UNAVAILABLE",
          message: "A entrega de documentos ainda não está configurada.",
        });
        return true;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (
        url.search !== "" ||
        request.headers["transfer-encoding"] ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      ) throw new DocumentDeliveryValidationError();
      const document = await dependencies.documentDelivery.download(
        principal.userId,
        pathSegments[3] ?? "",
        pathSegments[5] ?? "",
      );
      sendPrivateDocument(response, document);
      return true;
    }

    if (!caseRepository) {
      sendPrivateJson(response, 503, {
        code: "CASE_PORTFOLIO_UNAVAILABLE",
        message: "O detalhe do processo ainda não está configurado.",
      });
      return true;
    }

    const caseId = pathSegments[3] ?? "";
    if (isDocumentCollection) {
      if (!dependencies.documentRepository) {
        sendPrivateJson(response, 503, {
          code: "DOCUMENT_GATEWAY_UNAVAILABLE",
          message: "O gateway de documentos não está configurado.",
        });
        return true;
      }
      const documents = await listAuthorizedDocuments(
        principal,
        scope,
        caseId,
        caseRepository,
        dependencies.documentRepository,
      );
      sendPrivateJson(response, 200, { documents });
      return true;
    }

    if (isDocumentContent) {
      if (!dependencies.documentRepository || !dependencies.documentClient) {
        sendPrivateJson(response, 503, {
          code: "DOCUMENT_GATEWAY_UNAVAILABLE",
          message: "O gateway de documentos não está configurado.",
        });
        return true;
      }
      const document = await downloadAuthorizedDocument(
        principal,
        scope,
        caseId,
        pathSegments[5] ?? "",
        caseRepository,
        dependencies.documentRepository,
        dependencies.documentClient,
      );
      sendPrivateDocument(response, document);
      return true;
    }

    const foundCase = await getAuthorizedCase(
      principal,
      scope,
      caseId,
      caseRepository,
    );
    sendPrivateJson(
      response,
      200,
      isEvents ? { events: foundCase.events } : { case: foundCase },
    );
  } catch (error) {
    if (
      usesMaterializationRequest &&
      error instanceof DocumentMaterializationRequestValidationError
    ) {
      sendPrivateJson(response, 400, {
        code: "INVALID_DOCUMENT_MATERIALIZATION_REQUEST",
        message: error.message,
      });
      return true;
    }
    if (
      usesMaterializationRequest &&
      error instanceof DocumentMaterializationNotFoundError
    ) {
      sendPrivateJson(response, 404, {
        code: "DOCUMENT_NOT_FOUND",
        message: error.message,
      });
      return true;
    }
    if (
      usesMaterializationRequest &&
      error instanceof DocumentMaterializationProjectionError
    ) {
      sendPrivateJson(response, 503, {
        code: "DOCUMENT_MATERIALIZATION_UNAVAILABLE",
        message: "A preparação de documentos está temporariamente indisponível.",
      });
      return true;
    }
    if (
      usesPersistedDelivery &&
      (error instanceof PersistedDocumentNotFoundError ||
        error instanceof DocumentDeliveryValidationError)
    ) {
      sendPrivateJson(response, 404, {
        code: "DOCUMENT_NOT_FOUND",
        message: "Documento não encontrado.",
      });
      return true;
    }
    if (
      usesPersistedDelivery &&
      error instanceof DocumentDownloadQuotaExceededError
    ) {
      response.setHeader("retry-after", String(error.retryAfterSeconds));
      sendPrivateJson(response, 429, {
        code: "DOCUMENT_DOWNLOAD_QUOTA_EXCEEDED",
        message: error.message,
      });
      return true;
    }
    if (
      usesPersistedDelivery &&
      error instanceof DocumentContentUnavailableError
    ) {
      sendPrivateJson(response, 502, {
        code: "DOCUMENT_CONTENT_UNAVAILABLE",
        message: error.message,
      });
      return true;
    }
    if (error instanceof CaseTimelinePageValidationError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_CASE_TIMELINE_PAGE",
        message: error.message,
      });
      return true;
    }
    if (error instanceof CaseDocumentPageValidationError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_DOCUMENT_PAGE",
        message: error.message,
      });
      return true;
    }
    if (error instanceof CaseTimelineNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "CASE_NOT_FOUND",
        message: error.message,
      });
      return true;
    }
    if (error instanceof PersistedCasePageValidationError) {
      sendPrivateJson(response, 400, {
        code: "INVALID_CASE_PAGE",
        message: error.message,
      });
      return true;
    }
    if (
      error instanceof PortfolioAccessDeniedError ||
      error instanceof RepositoryAccessDeniedError
    ) {
      sendPrivateJson(response, 403, {
        code: "FORBIDDEN",
        message: "Acesso negado.",
      });
      return true;
    }
    if (
      error instanceof CaseDocumentsNotFoundError ||
      error instanceof DocumentNotFoundError ||
      ((isDocumentCollection || isDocumentContent) &&
        error instanceof PortfolioCaseNotFoundError)
    ) {
      sendPrivateJson(response, 404, {
        code: "DOCUMENT_NOT_FOUND",
        message: "Documento não encontrado.",
      });
      return true;
    }
    if (error instanceof PortfolioCaseNotFoundError) {
      sendPrivateJson(response, 404, {
        code: "CASE_NOT_FOUND",
        message: "Processo não encontrado.",
      });
      return true;
    }
    if (isDocumentContent) {
      sendPrivateJson(response, 502, {
        code: "DOCUMENT_SOURCE_UNAVAILABLE",
        message: "O documento não pôde ser obtido da fonte oficial.",
      });
      return true;
    }
    throw error;
  }

  return true;
};
