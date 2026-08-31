import { randomUUID } from "node:crypto";

import type { FoundationRepository } from "../application/foundation-repository.js";
import {
  PersonalAccountDataControls,
  type TenantExportReader,
} from "../application/account-data-controls.js";
import { TenantDataLifecycleService } from "../application/tenant-data-lifecycle.js";
import type { TenantDataLifecycleRequestRepository } from
  "../application/tenant-data-lifecycle.js";
import {
  PersonalDocumentMaterializationRequests,
  type DocumentMaterializationRequestRepository,
  type PersonalDocumentMaterializationRequestService,
} from "../application/document-materialization-request.js";
import {
  PersonalDocumentDelivery,
  type DocumentDeliveryRepository,
  type PersonalDocumentDeliveryService,
  type PrivateObjectStore,
} from "../application/individual-document-delivery.js";
import {
  MonitoringProfiles,
  type MonitoringProfilesService,
} from "../application/monitoring-profiles.js";
import { PersonalTenantResolver } from "../application/personal-tenant-resolver.js";
import { PersonalAlerts, type AlertRepository } from "../application/internal-alerts.js";
import { PersonalCaseTimeline, type PersistedCaseTimelineRepository } from "../application/persisted-case-timeline.js";
import { PersonalCaseDocuments, type PersistedCaseDocumentRepository } from "../application/persisted-case-documents.js";
import {
  PersonalCasePortfolio,
  type PersistedCasePortfolioRepository,
  type PersonalCasePortfolioService,
} from "../application/persisted-case-portfolio.js";
import { ProtectedSubjectFactory } from "../application/protected-subject-factory.js";
import type {
  DocumentDeliveryRuntimeConfig,
  FoundationRuntimeConfig,
} from "../configuration/runtime-config.js";
import { AesGcmIdentifierProtector } from "../infrastructure/aes-gcm-identifier-protector.js";
import { PostgresFoundationRepository } from "../infrastructure/postgres-foundation-repository.js";
import { PostgresTenantDataLifecycleRequestRepository } from "../infrastructure/postgres-tenant-data-lifecycle-request-repository.js";
import { LocalTenantLifecycleObjectStore } from "../infrastructure/local-tenant-lifecycle-object-store.js";
import { PostgresPersistedCasePortfolioRepository } from "../infrastructure/postgres-persisted-case-portfolio-repository.js";
import { PostgresAlertRepository } from "../infrastructure/postgres-alert-repository.js";
import { PostgresCaseTimelineRepository } from "../infrastructure/postgres-case-timeline-repository.js";
import { PostgresCaseDocumentRepository } from "../infrastructure/postgres-case-document-repository.js";
import { PostgresDocumentDeliveryRepository } from "../infrastructure/postgres-document-delivery-repository.js";
import { PostgresDocumentMaterializationRequestRepository } from
  "../infrastructure/postgres-document-materialization-request-repository.js";
import { LocalPrivateObjectStore } from "../infrastructure/local-private-object-store.js";
import { Sha256IdentityIdDeriver } from "../infrastructure/sha256-identity-id-deriver.js";
import { GcsObjectStore } from "../infrastructure/gcs-object-store.js";
import { GoogleCloudStorageGateway } from
  "../infrastructure/google-cloud-storage-gateway.js";
import { openPostgresRuntimePool } from
  "../infrastructure/postgres-runtime-pool.js";

interface RepositoryResource {
  readonly repository: FoundationRepository;
  readonly casePortfolioRepository?: PersistedCasePortfolioRepository;
  readonly alertRepository?: AlertRepository;
  readonly caseTimelineRepository?: PersistedCaseTimelineRepository;
  readonly caseDocumentRepository?: PersistedCaseDocumentRepository;
  readonly documentDeliveryRepository?: DocumentDeliveryRepository;
  readonly documentMaterializationRequestRepository?:
    DocumentMaterializationRequestRepository;
  readonly tenantDataLifecycleRepository?: TenantDataLifecycleRequestRepository;
  close(): Promise<void>;
}

interface FoundationCompositionDependencies {
  readonly openRepository?: (input: {
    readonly databaseUrl: string;
    readonly poolMax: number;
  }) => RepositoryResource;
  readonly createId?: () => string;
  readonly openObjectStore?: (root: string) => PrivateObjectStore;
  readonly openGcsObjectStore?: (input: {
    readonly bucketName: string;
    readonly maximumDocumentBytes: number;
    readonly maximumExportBytes: number;
  }) => PrivateObjectStore & TenantExportReader;
}

export interface ComposedFoundation {
  readonly monitoringProfiles?: MonitoringProfilesService;
  readonly casePortfolio?: PersonalCasePortfolioService;
  readonly alerts?: PersonalAlerts;
  readonly caseTimeline?: PersonalCaseTimeline;
  readonly caseDocuments?: PersonalCaseDocuments;
  readonly documentDelivery?: PersonalDocumentDeliveryService;
  readonly documentMaterializationRequests?:
    PersonalDocumentMaterializationRequestService;
  readonly accountDataControls?: PersonalAccountDataControls;
  close(): Promise<void>;
}

const openPostgresRepository = (input: {
  readonly databaseUrl: string;
  readonly poolMax: number;
}): RepositoryResource => {
  const pool = openPostgresRuntimePool({
    connectionString: input.databaseUrl,
    max: input.poolMax,
    workload: "api",
  });
  const repository = new PostgresFoundationRepository(pool);
  return {
    repository,
    casePortfolioRepository:
      new PostgresPersistedCasePortfolioRepository(pool),
    alertRepository: new PostgresAlertRepository(pool),
    caseTimelineRepository: new PostgresCaseTimelineRepository(pool),
    caseDocumentRepository: new PostgresCaseDocumentRepository(pool),
    documentDeliveryRepository: new PostgresDocumentDeliveryRepository(pool),
    documentMaterializationRequestRepository:
      new PostgresDocumentMaterializationRequestRepository(pool),
    tenantDataLifecycleRepository:
      new PostgresTenantDataLifecycleRequestRepository(pool),
    close: () => pool.end(),
  };
};

export const composeFoundation = (
  config: FoundationRuntimeConfig,
  documentDelivery: DocumentDeliveryRuntimeConfig = { mode: "disabled" },
  dependencies: FoundationCompositionDependencies = {},
): ComposedFoundation => {
  if (config.mode === "disabled") {
    return { close: () => Promise.resolve() };
  }

  const protector = new AesGcmIdentifierProtector({
    activeKeyVersion: config.activeKeyVersion,
    blindIndexVersion: config.blindIndexVersion,
    encryptionKeys: config.encryptionKeys,
    blindIndexKey: config.blindIndexKey,
  });
  const resource = (dependencies.openRepository ?? openPostgresRepository)({
    databaseUrl: config.databaseUrl,
    poolMax: config.poolMax,
  });
  const contextResolver = new PersonalTenantResolver(
    resource.repository,
    new Sha256IdentityIdDeriver(),
  );
  const gcsObjectStore = documentDelivery.mode === "gcs"
    ? (dependencies.openGcsObjectStore ?? ((input) => new GcsObjectStore(
        new GoogleCloudStorageGateway(input.bucketName),
        {
          maximumDocumentBytes: input.maximumDocumentBytes,
          maximumExportBytes: input.maximumExportBytes,
        },
      )))({
        bucketName: documentDelivery.bucketName,
        maximumDocumentBytes: documentDelivery.maximumBytes,
        maximumExportBytes: 10 * 1024 * 1024,
      })
    : undefined;

  return {
    monitoringProfiles: new MonitoringProfiles(
      contextResolver,
      resource.repository,
      new ProtectedSubjectFactory(protector),
      dependencies.createId ?? randomUUID,
    ),
    ...(resource.casePortfolioRepository
      ? {
          casePortfolio: new PersonalCasePortfolio(
            contextResolver,
            resource.casePortfolioRepository,
          ),
        }
      : {}),
    ...(resource.alertRepository
      ? { alerts: new PersonalAlerts(contextResolver, resource.alertRepository) }
      : {}),
    ...(resource.caseTimelineRepository
      ? { caseTimeline: new PersonalCaseTimeline(contextResolver, resource.caseTimelineRepository) }
      : {}),
    ...(resource.caseDocumentRepository
      ? { caseDocuments: new PersonalCaseDocuments(contextResolver, resource.caseDocumentRepository) }
      : {}),
    ...(resource.documentMaterializationRequestRepository
      ? {
          documentMaterializationRequests:
            new PersonalDocumentMaterializationRequests(
              contextResolver,
              resource.documentMaterializationRequestRepository,
              dependencies.createId ?? randomUUID,
            ),
        }
      : {}),
    ...(documentDelivery.mode !== "disabled" && resource.documentDeliveryRepository
      ? {
          documentDelivery: new PersonalDocumentDelivery(
            contextResolver,
            resource.documentDeliveryRepository,
            documentDelivery.mode === "local"
              ? (dependencies.openObjectStore ??
                  ((root: string) => new LocalPrivateObjectStore(root)))(
                  documentDelivery.objectRoot,
                )
              : gcsObjectStore!,
            {
              quotaPerMinute: documentDelivery.quotaPerMinute,
              maximumBytes: documentDelivery.maximumBytes,
            },
            dependencies.createId ?? randomUUID,
          ),
        }
      : {}),
    ...(documentDelivery.mode !== "disabled" && resource.tenantDataLifecycleRepository
      ? {
          accountDataControls: new PersonalAccountDataControls(
            contextResolver,
            new TenantDataLifecycleService(resource.tenantDataLifecycleRepository),
            documentDelivery.mode === "local"
              ? LocalTenantLifecycleObjectStore.reader(
                  documentDelivery.objectRoot,
                  10 * 1024 * 1024,
                )
              : gcsObjectStore!,
            dependencies.createId ?? randomUUID,
          ),
        }
      : {}),
    close: () => resource.close(),
  };
};
