import 'reflect-metadata';
import { HEADERS } from '@payment-sim/shared';
import cors from 'cors';
import type { Express, Router } from 'express';
import express from 'express';
import helmet from 'helmet';
import type { Configuration } from './config';
import { createDocsController } from './docs/docs.controller';
import { API_VERSION, buildOpenApiDocument } from './docs/openapi';
import {
  errorHandler,
  notFoundHandler,
} from './libs/common/middlewares/error-handler.middleware';
import { httpLogger } from './libs/common/middlewares/http-logger.middleware';
import { createRateLimiter } from './libs/common/middlewares/rate-limit.middleware';
import {
  assignRequestId,
  bindRequestContext,
} from './libs/common/middlewares/request-id.middleware';
import type { Logger } from './libs/core/logger/logger';
import { createHealthController } from './modules/health/controllers/health.controller';
import type { HealthService } from './modules/health/services/health.service';

export interface AppDependencies {
  config: Readonly<Configuration>;
  logger: Logger;
  healthService: HealthService;
  /** Feature routes, mounted under /api/v1. */
  apiRouter: Router;
}

/** Builds the HTTP app without listening, so tests drive it in-process with supertest. */
export function createApp({
  config,
  logger,
  healthService,
  apiRouter,
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(assignRequestId());
  app.use(httpLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      allowedHeaders: [
        'Content-Type',
        HEADERS.IDEMPOTENCY_KEY,
        HEADERS.IF_MATCH,
        HEADERS.REQUEST_ID,
      ],
      exposedHeaders: [
        HEADERS.REQUEST_ID,
        HEADERS.ETAG,
        HEADERS.IDEMPOTENT_REPLAYED,
        'RateLimit',
        'RateLimit-Policy',
        'Retry-After',
      ],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(bindRequestContext());

  app.use(createHealthController(healthService));
  app.use(createDocsController(buildOpenApiDocument(API_VERSION)));
  app.use(
    '/api/v1',
    createRateLimiter({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
    }),
    createRateLimiter({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_WRITE_MAX,
      writesOnly: true,
    }),
    apiRouter,
  );

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
