import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { IdempotencyKey } from '../../../modules/payments/entity/idempotency-key.entity';
import { PaymentEvent } from '../../../modules/payments/entity/payment-event.entity';
import { Payment } from '../../../modules/payments/entity/payment.entity';
import { Job } from '../../../modules/processing/entity/job.entity';
import type { Logger } from '../logger/logger';
import { InitialSchema1792067376000 } from './migrations/1792067376000-InitialSchema';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { TypeOrmPinoLogger } from './typeorm-logger';

/** Listed explicitly, not globbed, so the same list works from src (tsx, ts-jest) and dist. */
export const ENTITIES = [Payment, PaymentEvent, IdempotencyKey, Job];
export const MIGRATIONS = [InitialSchema1792067376000];

export interface DataSourceOptions {
  url: string;
  logger: Logger;
  poolMax?: number;
  statementTimeoutMs?: number;
  slowQueryMs?: number;
}

/**
 * TLS comes from the connection string (Neon URLs carry sslmode=require) and certificates are
 * verified — unlike the template's `rejectUnauthorized: false`. The schema is owned by
 * migrations; `synchronize` is never enabled.
 */
export function createDataSource({
  url,
  logger,
  poolMax = 10,
  statementTimeoutMs = 10_000,
  slowQueryMs = 500,
}: DataSourceOptions): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    migrationsRun: false,
    uuidExtension: 'pgcrypto',
    namingStrategy: new SnakeNamingStrategy(),
    logger: new TypeOrmPinoLogger(logger),
    logging: true,
    maxQueryExecutionTime: slowQueryMs,
    extra: {
      max: poolMax,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: statementTimeoutMs,
      application_name: 'payment-api',
    },
  });
}
