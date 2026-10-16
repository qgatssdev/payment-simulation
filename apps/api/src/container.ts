import { Router } from 'express';
import type { AppDependencies } from './app';
import type { Configuration } from './config';
import { MockPaymentGateway } from './infra/gateway/mock-payment-gateway';
import type { PaymentGateway } from './infra/gateway/payment-gateway';
import type { PaymentStore } from './infra/store/payment-store';
import { openPaymentStore } from './infra/store/payment-store';
import type { Logger } from './libs/core/logger/logger';
import { InsightsService } from './modules/insights/services/insights.service';
import { StoreReadinessCheck } from './modules/health/checks/store.check';
import { HealthService } from './modules/health/services/health.service';
import { createPaymentController } from './modules/payments/controllers/payment.controller';
import { IdempotencyKeyRepository } from './modules/payments/repository/idempotency-key.repository';
import { PaymentEventRepository } from './modules/payments/repository/payment-event.repository';
import { PaymentRepository } from './modules/payments/repository/payment.repository';
import { PaymentService } from './modules/payments/services/payment.service';
import { JobRepository } from './modules/processing/repository/job.repository';
import { PaymentProcessor } from './modules/processing/services/payment-processor';
import { PaymentWorker } from './modules/processing/worker/payment-worker';
import { createStreamController } from './modules/realtime/controllers/stream.controller';
import type { PaymentEventPublisher } from './modules/realtime/payment-event.publisher';
import { AfterCommitPublisher } from './modules/realtime/payment-event.publisher';
import { RealtimeHub } from './modules/realtime/realtime-hub';
import { SseRegistry } from './modules/realtime/sse';

export interface Container extends AppDependencies {
  store: PaymentStore;
  paymentService: PaymentService;
  gateway: PaymentGateway;
  publisher: PaymentEventPublisher;
  /** Not started here: server.ts starts it when WORKER_ENABLED, tests drive it directly. */
  worker: PaymentWorker;
  hub: RealtimeHub;
  streams: SseRegistry;
  /** End open SSE responses so the HTTP server can finish closing. */
  closeStreams(): void;
  /** Release resources in reverse order of acquisition. */
  shutdown(): Promise<void>;
}

export interface ContainerOverrides {
  /** An already-open store (tests). The container will not close it. */
  store?: PaymentStore;
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

  let store = overrides.store;
  if (!store) {
    const owned = await openPaymentStore({
      file: config.DATA_FILE,
      logger,
      clock: overrides.clock,
    });
    // Closing flushes anything pending and releases the data file's lock.
    shutdownHooks.push(() => owned.close());
    logger.info(
      { file: owned.persistent ? config.DATA_FILE : '(in memory)' },
      'storage ready',
    );
    store = owned;
  }

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

  const idempotencyKeys = new IdempotencyKeyRepository(store);
  const purged = await idempotencyKeys.purgeExpired(store.now());
  if (purged > 0) logger.info({ purged }, 'removed expired idempotency keys');

  // The publisher wakes the worker after a job commits and the worker needs the service:
  // the callback reads `worker` only when invoked, after both exist.
  const hub = new RealtimeHub(logger);
  const publisher = new AfterCommitPublisher(hub, () => worker.notify());
  const paymentService = new PaymentService({
    store,
    payments: new PaymentRepository(store),
    events: new PaymentEventRepository(store),
    jobs: new JobRepository(store),
    idempotencyKeys,
    gateway,
    publisher,
    logger,
    clock: overrides.clock,
    jobMaxAttempts: config.JOB_MAX_ATTEMPTS,
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
      jobs: new JobRepository(store),
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
  // Hooks run in reverse: stop the worker (drains in-flight jobs), then close the store.
  shutdownHooks.push(() => worker.stop());

  const streams = new SseRegistry(config.SSE_MAX_CLIENTS, config.SSE_HEARTBEAT_MS);
  const healthService = new HealthService(
    [new StoreReadinessCheck(store)],
    logger,
    config.buildSha,
  );

  const apiRouter = Router();
  const insights = new InsightsService({
    payments: new PaymentRepository(store),
    events: new PaymentEventRepository(store),
    clock: overrides.clock,
  });
  apiRouter.use(createPaymentController(paymentService, insights));
  apiRouter.use(
    createStreamController({
      payments: paymentService,
      hub,
      registry: streams,
      logger,
      replayLimit: config.SSE_REPLAY_LIMIT,
    }),
  );

  return {
    config,
    logger,
    store,
    paymentService,
    gateway,
    publisher,
    worker,
    hub,
    streams,
    healthService,
    apiRouter,
    closeStreams: () => streams.closeAll(),
    async shutdown() {
      streams.closeAll();
      for (const hook of shutdownHooks.reverse()) await hook();
    },
  };
}
