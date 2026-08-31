import {
  MonitoringWorker,
  type MonitoringSourceRegistry,
  type MonitoringWorkRepository,
} from "../application/monitoring-worker.js";
import type { MonitoringWorkerRuntimeConfig } from "../configuration/monitoring-worker-config.js";
import { AesGcmIdentifierProtector } from "../infrastructure/aes-gcm-identifier-protector.js";
import { PostgresMonitoringWorkRepository } from "../infrastructure/postgres-monitoring-work-repository.js";
import { openPostgresRuntimePool } from
  "../infrastructure/postgres-runtime-pool.js";

interface WorkerRepositoryResource {
  readonly repository: MonitoringWorkRepository;
  close(): Promise<void>;
}

interface MonitoringWorkerCompositionDependencies {
  readonly openRepository?: (input: {
    readonly databaseUrl: string;
    readonly poolMax: number;
  }) => WorkerRepositoryResource;
  readonly sources?: MonitoringSourceRegistry;
  readonly now?: () => Date;
}

export interface ComposedMonitoringWorker {
  readonly worker: MonitoringWorker;
  close(): Promise<void>;
}

const noSources: MonitoringSourceRegistry = { resolve: () => undefined };

const openPostgresRepository = (input: {
  readonly databaseUrl: string;
  readonly poolMax: number;
}): WorkerRepositoryResource => {
  const pool = openPostgresRuntimePool({
    connectionString: input.databaseUrl,
    max: input.poolMax,
    workload: "monitoring-worker",
  });
  return {
    repository: new PostgresMonitoringWorkRepository(pool),
    close: () => pool.end(),
  };
};

export const composeMonitoringWorker = (
  config: MonitoringWorkerRuntimeConfig,
  dependencies: MonitoringWorkerCompositionDependencies = {},
): ComposedMonitoringWorker => {
  const resource = (dependencies.openRepository ?? openPostgresRepository)({
    databaseUrl: config.databaseUrl,
    poolMax: config.poolMax,
  });
  const protector = new AesGcmIdentifierProtector(config.encryption);
  return {
    worker: new MonitoringWorker(
      resource.repository,
      protector,
      dependencies.sources ?? noSources,
      () => undefined,
      config.worker,
      dependencies.now ?? (() => new Date()),
    ),
    close: () => resource.close(),
  };
};
