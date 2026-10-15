import type { DataSource } from 'typeorm';
import { createApp } from '../app';
import type { ContainerOverrides } from '../container';
import { createContainer } from '../container';
import { createDataSource } from '../libs/core/db/data-source';
import { createLogger } from '../libs/core/logger/logger';
import { testConfig } from './helpers';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://localhost:5432/payments_test';

/**
 * Integration tests drop and recreate the schema, so they refuse any database whose name does
 * not end in `_test`. TEST_DATABASE_URL is read on its own and never falls back to
 * DATABASE_URL, so a dev or production database can't be wiped by accident.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}": the database name must end in _test`,
    );
  }
  return url;
}

export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = createDataSource({
    url: testDatabaseUrl(),
    logger: createLogger({ level: 'silent', pretty: false }),
    poolMax: 5,
  });
  return dataSource.initialize();
}

/**
 * The real app on the real object graph, over the test database: the same createContainer
 * wiring production uses, minus owning the connection.
 */
export async function createIntegrationApp(
  dataSource: DataSource,
  overrides: Omit<ContainerOverrides, 'dataSource'> = {},
  env: NodeJS.ProcessEnv = {},
) {
  const config = testConfig({
    RATE_LIMIT_MAX: '10000',
    RATE_LIMIT_WRITE_MAX: '10000',
    ...env,
  });
  const container = await createContainer(
    config,
    createLogger({ level: 'silent', pretty: false }),
    { ...overrides, dataSource },
  );
  return { app: createApp(container), container };
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE "jobs", "idempotency_keys", "payment_events", "payments" RESTART IDENTITY CASCADE',
  );
}
