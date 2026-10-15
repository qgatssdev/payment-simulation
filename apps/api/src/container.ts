import { Router } from 'express';
import type { AppDependencies } from './app';
import type { Configuration } from './config';
import type { Logger } from './libs/core/logger/logger';
import { HealthService } from './modules/health/services/health.service';

export interface Container extends AppDependencies {
  /** Release resources in reverse order of acquisition. */
  shutdown(): Promise<void>;
}

/**
 * Composition root: the one place that knows how the object graph is wired. Replaces Nest's
 * DI container (and the template's property @Inject) with plain constructor injection, which
 * keeps every class testable with hand-written fakes.
 */
export function createContainer(
  config: Readonly<Configuration>,
  logger: Logger,
): Promise<Container> {
  const shutdownHooks: Array<() => Promise<void>> = [];

  const healthService = new HealthService([], logger, config.buildSha);
  const apiRouter = Router();

  return Promise.resolve({
    config,
    logger,
    healthService,
    apiRouter,
    async shutdown() {
      for (const hook of shutdownHooks.reverse()) await hook();
    },
  });
}
