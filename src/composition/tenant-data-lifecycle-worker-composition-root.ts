import { randomUUID } from "node:crypto";

import {
  TenantDataLifecycleWorker,
  type TenantDataLifecycleWorkerRepository,
  type TenantLifecycleObjectStore,
} from "../application/tenant-data-lifecycle-worker.js";
import type { TenantDataLifecycleWorkerRuntimeConfig } from
  "../configuration/tenant-data-lifecycle-worker-config.js";
import { AesGcmIdentifierProtector } from
  "../infrastructure/aes-gcm-identifier-protector.js";
import { LocalTenantLifecycleObjectStore } from
  "../infrastructure/local-tenant-lifecycle-object-store.js";
import { PostgresTenantDataLifecycleWorkerRepository } from
  "../infrastructure/postgres-tenant-data-lifecycle-worker-repository.js";
import { GcsObjectStore } from "../infrastructure/gcs-object-store.js";
import { GoogleCloudStorageGateway } from
  "../infrastructure/google-cloud-storage-gateway.js";
import { openPostgresRuntimePool } from
  "../infrastructure/postgres-runtime-pool.js";

type EnabledConfig = Exclude<
  TenantDataLifecycleWorkerRuntimeConfig,
  { readonly mode: "disabled" }
>;

interface RepositoryResource {
  readonly repository: TenantDataLifecycleWorkerRepository;
  close(): Promise<void>;
}

interface CompositionDependencies {
  readonly openRepository?: (input: {
    readonly databaseUrl: string;
    readonly poolMax: number;
  }) => RepositoryResource;
  readonly openStore?: (input: {
    readonly objectRoot: string;
    readonly maximumExportBytes: number;
  }) => Promise<TenantLifecycleObjectStore>;
  readonly openGcsStore?: (input: {
    readonly bucketName: string;
    readonly maximumExportBytes: number;
  }) => TenantLifecycleObjectStore;
  readonly now?: () => Date;
  readonly artifactId?: () => string;
}

const openRepository = (input: {
  readonly databaseUrl: string;
  readonly poolMax: number;
}): RepositoryResource => {
  const pool = openPostgresRuntimePool({
    connectionString: input.databaseUrl,
    max: input.poolMax,
    workload: "tenant-lifecycle-worker",
  });
  return {
    repository: new PostgresTenantDataLifecycleWorkerRepository(pool),
    close: () => pool.end(),
  };
};

const openStore = (input: {
  readonly objectRoot: string;
  readonly maximumExportBytes: number;
}): Promise<TenantLifecycleObjectStore> =>
  LocalTenantLifecycleObjectStore.create(
    input.objectRoot, input.maximumExportBytes,
  );

const openGcsStore = (input: {
  readonly bucketName: string;
  readonly maximumExportBytes: number;
}): TenantLifecycleObjectStore => new GcsObjectStore(
  new GoogleCloudStorageGateway(input.bucketName),
  {
    maximumDocumentBytes: 25 * 1024 * 1024,
    maximumExportBytes: input.maximumExportBytes,
  },
);

export const composeTenantDataLifecycleWorker = async (
  config: EnabledConfig,
  dependencies: CompositionDependencies = {},
): Promise<{
  readonly worker: TenantDataLifecycleWorker;
  close(): Promise<void>;
}> => {
  const resource = (dependencies.openRepository ?? openRepository)({
    databaseUrl: config.databaseUrl,
    poolMax: config.poolMax,
  });
  try {
    const store = config.mode === "local"
      ? await (dependencies.openStore ?? openStore)({
          objectRoot: config.objectRoot,
          maximumExportBytes: config.worker.maximumExportBytes,
        })
      : (dependencies.openGcsStore ?? openGcsStore)({
          bucketName: config.bucketName,
          maximumExportBytes: config.worker.maximumExportBytes,
        });
    return {
      worker: new TenantDataLifecycleWorker(
        resource.repository,
        store,
        new AesGcmIdentifierProtector(config.encryption),
        () => undefined,
        config.worker,
        dependencies.now ?? (() => new Date()),
        dependencies.artifactId ?? randomUUID,
      ),
      close: () => resource.close(),
    };
  } catch (error) {
    await resource.close();
    throw error;
  }
};
