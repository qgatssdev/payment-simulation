import 'reflect-metadata';
import { migrate } from '../libs/core/db/migrator';
import { createTestDataSource } from './database';

/** Fresh schema per run, built by the real migrations (not synchronize). */
export default async function globalSetup(): Promise<void> {
  const dataSource = await createTestDataSource();
  try {
    await dataSource.dropDatabase();
    await migrate(dataSource);
  } finally {
    await dataSource.destroy();
  }
}
