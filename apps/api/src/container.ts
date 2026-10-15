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
import { PaymentProcessor } from './modules/processing/services/payment-processor';
import { PaymentWorker } from './modules/processing/worker/payment-worker';
import type { PaymentGateway } from './infra/gateway/payment-gateway';
import { MockPaymentGateway } from './infra/gateway/mock-payment-gateway';

export interface Container extends AppDependencies {
  dataSource: DataSource;
  paymentService: PaymentService;
  gateway: PaymentGateway;
  /** Not started here: server.ts starts it when WORKER_ENABLED, tests drive it directly. */
  worker: PaymentWorker;
  /** Release resources in reverse order of acquisition. */
  shutdown(): Promise<void>;
}

export interface ContainerOverrides {
  /** An already-initialised data source (tests). The container will not close it. */
  dataSource?: DataSource;
  clock?: () => Date;
  gateway?: PaymentGateway;
  random?: () => number;
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
  const gateway =
    overrides.gateway ??
    new MockPaymentGateway({
      minLatencyMs: config.GATEWAY_MIN_LATENCY_MS,
      maxLatencyMs: config.GATEWAY_MAX_LATENCY_MS,
      declineRate: config.GATEWAY_DECLINE_RATE,
      transientErrorRate: config.GATEWAY_TRANSIENT_ERROR_RATE,
      random: overrides.random,
    });
  const backoff = {
    baseDelayMs: config.RETRY_BASE_DELAY_MS,
    maxDelayMs: config.RETRY_MAX_DELAY_MS,
  };

  // The service wakes the worker after enqueueing and the worker needs the service: the
  // callback reads `worker` only when invoked, after both exist.
  const paymentService = new PaymentService({
    dataSource,
    payments: new PaymentRepository(manager),
    events: new PaymentEventRepository(manager),
    jobs: new JobRepository(manager),
    idempotencyKeys: new IdempotencyKeyRepository(manager),
    gateway,
    logger,
    clock: overrides.clock,
    jobMaxAttempts: config.JOB_MAX_ATTEMPTS,
    onJobEnqueued: () => worker.notify(),
  });

  const processor = new PaymentProcessor({
    payments: paymentService,
    gateway,
    logger,
    gatewayTimeoutMs: config.GATEWAY_TIMEOUT_MS,
    backoff,
    clock: overrides.clock,
    random: overrides.random,
  });
  const worker = new PaymentWorker(
    {
      jobs: new JobRepository(manager),
      processor,
      payments: paymentService,
      logger,
      clock: overrides.clock,
      random: overrides.random,
    },
    {
      concurrency: config.WORKER_CONCURRENCY,
      pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
      lockTimeoutMs: config.WORKER_LOCK_TIMEOUT_MS,
      backoff,
    },
  );
  // Registered after the database, so it runs first: drain jobs, then close connections.
  shutdownHooks.push(() => worker.stop());

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
    gateway,
    worker,
    healthService,
    apiRouter,
    async shutdown() {
      for (const hook of shutdownHooks.reverse()) await hook();
    },
  };
}
