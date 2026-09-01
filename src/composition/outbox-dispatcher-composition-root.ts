import {
  OutboxDispatcher,
  type OutboxPublisher,
  type OutboxRepository,
} from "../application/outbox-dispatcher.js";
import type { OutboxDispatcherRuntimeConfig } from "../configuration/outbox-dispatcher-config.js";
import { PostgresOutboxRepository } from "../infrastructure/postgres-outbox-repository.js";
import { PostgresInternalAlertPublisher } from "../infrastructure/postgres-internal-alert-publisher.js";
import { openPostgresRuntimePool } from
  "../infrastructure/postgres-runtime-pool.js";

interface DispatcherRepositoryResource {
  readonly repository: OutboxRepository;
  readonly publisher?: OutboxPublisher;
  close(): Promise<void>;
}

interface OutboxDispatcherCompositionDependencies {
  readonly openRepository?: (input: {
    readonly databaseUrl: string;
    readonly poolMax: number;
  }) => DispatcherRepositoryResource;
  readonly publisher?: OutboxPublisher;
  readonly now?: () => Date;
}

export interface ComposedOutboxDispatcher {
  readonly dispatcher: OutboxDispatcher;
  close(): Promise<void>;
}

const disabledPublisher: OutboxPublisher = {
  publish: () => Promise.reject(new Error("Outbox publisher is disabled.")),
};

const openPostgresRepository = (input: {
  readonly databaseUrl: string;
  readonly poolMax: number;
}): DispatcherRepositoryResource => {
  const pool = openPostgresRuntimePool({
    connectionString: input.databaseUrl,
    max: input.poolMax,
    workload: "outbox-dispatcher",
  });
  return {
    repository: new PostgresOutboxRepository(pool),
    publisher: new PostgresInternalAlertPublisher(pool),
    close: () => pool.end(),
  };
};

export const composeOutboxDispatcher = (
  config: OutboxDispatcherRuntimeConfig,
  dependencies: OutboxDispatcherCompositionDependencies = {},
): ComposedOutboxDispatcher => {
  const resource = (dependencies.openRepository ?? openPostgresRepository)({
    databaseUrl: config.databaseUrl,
    poolMax: config.poolMax,
  });
  return {
    dispatcher: new OutboxDispatcher(
      resource.repository,
      dependencies.publisher ?? resource.publisher ?? disabledPublisher,
      () => undefined,
      config.dispatcher,
      dependencies.now,
    ),
    close: () => resource.close(),
  };
};
