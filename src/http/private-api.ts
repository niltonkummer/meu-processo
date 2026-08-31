import type { TokenVerifier } from "../application/authentication.js";
import type { CaseRepository } from "../application/case-portfolio.js";
import type {
  DocumentClient,
  DocumentRepository,
} from "../application/document-gateway.js";
import type { PersonalDocumentMaterializationRequestService } from "../application/document-materialization-request.js";
import type { PersonalAlertsService } from "../application/internal-alerts.js";
import type { MonitoringProfilesService } from "../application/monitoring-profiles.js";
import type { PersonalCaseDocumentsService } from "../application/persisted-case-documents.js";
import type { PersonalCasePortfolioService } from "../application/persisted-case-portfolio.js";
import type { PersonalCaseTimelineService } from "../application/persisted-case-timeline.js";
import type { PersonalDocumentDeliveryService } from "../application/individual-document-delivery.js";
import type { DjenPublicationLocator } from "../application/publication-proxy.js";
import type { RequestRateLimiter } from "../application/request-rate-limiter.js";
import type { AssistedRendererConnector } from "../application/assisted-document-session.js";
import type { DjenClient } from "../application/types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountDataControlsService } from "../application/account-data-controls.js";
import type { PersonalBillingService } from "../application/personal-billing.js";
import type { BillingWebhook } from "../application/billing-webhook.js";

export interface PrivateApiDependencies {
  readonly client: DjenClient;
  readonly tokenVerifier?: TokenVerifier | undefined;
  readonly caseRepository?: CaseRepository | undefined;
  readonly documentRepository?: DocumentRepository | undefined;
  readonly documentClient?: DocumentClient | undefined;
  readonly publicationLocator?: DjenPublicationLocator | undefined;
  readonly requestRateLimiter?: RequestRateLimiter | undefined;
  readonly rendererConnector?: AssistedRendererConnector | undefined;
  readonly monitoringProfiles?: MonitoringProfilesService | undefined;
  readonly casePortfolio?: PersonalCasePortfolioService | undefined;
  readonly alerts?: PersonalAlertsService | undefined;
  readonly caseTimeline?: PersonalCaseTimelineService | undefined;
  readonly caseDocuments?: PersonalCaseDocumentsService | undefined;
  readonly documentDelivery?: PersonalDocumentDeliveryService | undefined;
  readonly documentMaterializationRequests?:
    PersonalDocumentMaterializationRequestService | undefined;
  readonly accountDataControls?: AccountDataControlsService | undefined;
  readonly billing?: PersonalBillingService | undefined;
  readonly billingWebhook?: BillingWebhook | undefined;
}

export interface AppServerOptions extends PrivateApiDependencies {
  readonly webRoot?: string | undefined;
}

export type PrivateRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: PrivateApiDependencies,
) => Promise<boolean>;
