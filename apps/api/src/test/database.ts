import type { DataSource } from 'typeorm';
import { createDataSource } from '../libs/core/db/data-source';
import { createLogger } from '../libs/core/logger/logger';

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

export async function truncateAll(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE "jobs", "idempotency_keys", "payment_events", "payments" RESTART IDENTITY CASCADE',
  );
}
