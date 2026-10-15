import { Router } from 'express';
import type { DataSource } from 'typeorm';
import type { AppDependencies } from './app';
import type { Configuration } from './config';
import { createDataSource } from './libs/core/db/data-source';
import type { Logger } from './libs/core/logger/logger';
import { DatabaseReadinessCheck } from './modules/health/checks/database.check';
import { HealthService } from './modules/health/services/health.service';
import { createPaymentController } from './modules/payments/controllers/payment.controller';
import { IdempotencyKeyRepository } from './modules/payments/repository/idempotency-key.repository';
import { PaymentEventRepository } from './modules/payments/repository/payment-event.repository';
import { PaymentRepository } from './modules/payments/repository/payment.repository';
import { PaymentService } from './modules/payments/services/payment.service';
import { JobRepository } from './modules/processing/repository/job.repository';

export interface Container extends AppDependencies {
  dataSource: DataSource;
  paymentService: PaymentService;
  /** Release resources in reverse order of acquisition. */
  shutdown(): Promise<void>;
}

export interface ContainerOverrides {
  /** An already-initialised data source (tests). The container will not close it. */
  dataSource?: DataSource;
  clock?: () => Date;
}

/**
 * Composition root: the one place that knows how the object graph is wired. Replaces Nest's
 * DI container (and the template's property @Inject) with plain constructor injection, which
 * keeps every class testable with hand-written fakes.
 */
export async function createContainer(
  config: Readonly<Configuration>,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  const shutdownHooks: Array<() => Promise<void>> = [];

  let dataSource = overrides.dataSource;
  if (!dataSource) {
    const owned = createDataSource({
      url: config.DATABASE_URL,
      logger,
      poolMax: config.DATABASE_POOL_MAX,
      statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
      slowQueryMs: config.DATABASE_SLOW_QUERY_MS,
    });
    await owned.initialize();
    shutdownHooks.push(() => owned.destroy());
    logger.info('database connected');
    dataSource = owned;
  }

  const manager = dataSource.manager;
  const paymentService = new PaymentService({
    dataSource,
    payments: new PaymentRepository(manager),
    events: new PaymentEventRepository(manager),
    jobs: new JobRepository(manager),
    idempotencyKeys: new IdempotencyKeyRepository(manager),
    logger,
    clock: overrides.clock,
  });

  const healthService = new HealthService(
    [new DatabaseReadinessCheck(dataSource)],
    logger,
    config.buildSha,
  );

  const apiRouter = Router();
  apiRouter.use(createPaymentController(paymentService));

  return {
    config,
    logger,
    dataSource,
    paymentService,
    healthService,
    apiRouter,
    async shutdown() {
      for (const hook of shutdownHooks.reverse()) await hook();
    },
  };
}
