import {
  deterministicDocumentArtifactId,
  DocumentMaterializationWorker,
  type DocumentMaterializationRepository,
  type DocumentMaterializationSourceAdapter,
  type DocumentMaterializationStore,
} from "../application/document-materialization-worker.js";
import type { DocumentMaterializationRuntimeConfig } from
  "../configuration/document-materialization-worker-config.js";
import {
  DeterministicFixturePdfScanner,
  LocalDocumentFixtureSource,
  LocalDocumentMaterializationStore,
} from "../infrastructure/local-document-materialization.js";
import { PostgresDocumentMaterializationRepository } from
  "../infrastructure/postgres-document-materialization-repository.js";
import { GcsObjectStore } from "../infrastructure/gcs-object-store.js";
import { GoogleCloudStorageGateway } from
  "../infrastructure/google-cloud-storage-gateway.js";
import { openPostgresRuntimePool } from
  "../infrastructure/postgres-runtime-pool.js";

type EnabledConfig = Exclude<
  DocumentMaterializationRuntimeConfig,
  { readonly mode: "disabled" }
>;

interface RepositoryResource {
  readonly repository: DocumentMaterializationRepository;
  close(): Promise<void>;
}

interface CompositionDependencies {
  readonly openRepository?: (input: {
    readonly databaseUrl: string;
    readonly poolMax: number;
  }) => RepositoryResource;
  readonly openSource?: (input: {
    readonly fixtureRoot: string;
    readonly sourceCode: string;
    readonly maximumBytes: number;
  }) => Promise<DocumentMaterializationSourceAdapter>;
  readonly openStore?: (input: {
    readonly objectRoot: string;
    readonly maximumBytes: number;
  }) => Promise<DocumentMaterializationStore>;
  readonly openGcsStore?: (input: {
    readonly bucketName: string;
    readonly maximumBytes: number;
  }) => DocumentMaterializationStore;
  readonly now?: () => Date;
}

const openRepository = (input: {
  readonly databaseUrl: string;
  readonly poolMax: number;
}): RepositoryResource => {
  const pool = openPostgresRuntimePool({
    connectionString: input.databaseUrl,
    max: input.poolMax,
    workload: "document-worker",
  });
  return {
    repository: new PostgresDocumentMaterializationRepository(pool),
    close: () => pool.end(),
  };
};

const openFixtureSource = (input: {
  readonly fixtureRoot: string;
  readonly sourceCode: string;
  readonly maximumBytes: number;
}): Promise<DocumentMaterializationSourceAdapter> =>
  LocalDocumentFixtureSource.create(
    input.fixtureRoot, input.sourceCode, input.maximumBytes,
  );

const openLocalStore = (input: {
  readonly objectRoot: string;
  readonly maximumBytes: number;
}): Promise<DocumentMaterializationStore> =>
  LocalDocumentMaterializationStore.create(input.objectRoot, input.maximumBytes);

const openGcsStore = (input: {
  readonly bucketName: string;
  readonly maximumBytes: number;
}): DocumentMaterializationStore => new GcsObjectStore(
  new GoogleCloudStorageGateway(input.bucketName),
  {
    maximumDocumentBytes: input.maximumBytes,
    maximumExportBytes: 10 * 1024 * 1024,
  },
);

export const composeDocumentMaterializationWorker = async (
  config: EnabledConfig,
  dependencies: CompositionDependencies = {},
): Promise<{
  readonly worker: DocumentMaterializationWorker;
  close(): Promise<void>;
}> => {
  const resource = (dependencies.openRepository ?? openRepository)({
    databaseUrl: config.databaseUrl,
    poolMax: config.poolMax,
  });
  try {
    const [source, store] = await Promise.all([
      (dependencies.openSource ?? openFixtureSource)({
        fixtureRoot: config.fixtureRoot,
        sourceCode: config.sourceCode,
        maximumBytes: config.worker.maximumBytes,
      }),
      config.mode === "local-fixture"
        ? (dependencies.openStore ?? openLocalStore)({
            objectRoot: config.objectRoot,
            maximumBytes: config.worker.maximumBytes,
          })
        : Promise.resolve((dependencies.openGcsStore ?? openGcsStore)({
            bucketName: config.bucketName,
            maximumBytes: config.worker.maximumBytes,
          })),
    ]);
    return {
      worker: new DocumentMaterializationWorker(
        resource.repository,
        { resolve: (sourceCode) => sourceCode === source.sourceCode
          ? source : undefined },
        new DeterministicFixturePdfScanner(),
        store,
        () => undefined,
        config.worker,
        dependencies.now ?? (() => new Date()),
        deterministicDocumentArtifactId,
      ),
      close: () => resource.close(),
    };
  } catch (error) {
    await resource.close();
    throw error;
  }
};
