import { Router } from 'express';
import type { DataSource } from 'typeorm';
import type { AppDependencies } from './app';
import type { Configuration } from './config';
import { createDataSource } from './libs/core/db/data-source';
import type { Logger } from './libs/core/logger/logger';
import { DatabaseReadinessCheck } from './modules/health/checks/database.check';
import { HealthService } from './modules/health/services/health.service';

export interface Container extends AppDependencies {
  dataSource: DataSource;
  /** Release resources in reverse order of acquisition. */
  shutdown(): Promise<void>;
}

/**
 * Composition root: the one place that knows how the object graph is wired. Replaces Nest's
 * DI container (and the template's property @Inject) with plain constructor injection, which
 * keeps every class testable with hand-written fakes.
 */
export async function createContainer(
  config: Readonly<Configuration>,
  logger: Logger,
): Promise<Container> {
  const shutdownHooks: Array<() => Promise<void>> = [];

  const dataSource = createDataSource({
    url: config.DATABASE_URL,
    logger,
    poolMax: config.DATABASE_POOL_MAX,
    statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
    slowQueryMs: config.DATABASE_SLOW_QUERY_MS,
  });
  await dataSource.initialize();
  shutdownHooks.push(() => dataSource.destroy());
  logger.info('database connected');

  const healthService = new HealthService(
    [new DatabaseReadinessCheck(dataSource)],
    logger,
    config.buildSha,
  );
  const apiRouter = Router();

  return {
    config,
    logger,
    dataSource,
    healthService,
    apiRouter,
    async shutdown() {
      for (const hook of shutdownHooks.reverse()) await hook();
    },
  };
}
