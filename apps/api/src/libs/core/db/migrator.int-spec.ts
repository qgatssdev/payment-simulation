import type { DataSource } from 'typeorm';
import { testDatabaseUrl } from '../../../test/database';
import { createLogger } from '../logger/logger';
import { createDataSource } from './data-source';
import { migrate, revertLastMigration } from './migrator';

/** The migrate script runs with a single connection; the tests must too. */
function singleConnectionDataSource(): Promise<DataSource> {
  return createDataSource({
    url: testDatabaseUrl(),
    logger: createLogger({ level: 'silent', pretty: false }),
    poolMax: 1,
  }).initialize();
}

describe('migrator', () => {
  const opened: DataSource[] = [];
  const open = async () => {
    const ds = await singleConnectionDataSource();
    opened.push(ds);
    return ds;
  };

  afterAll(async () => {
    await Promise.all(opened.map((ds) => ds.destroy()));
  });

  it('runs on a single pooled connection without deadlocking on its own lock', async () => {
    const ds = await open();
    await revertLastMigration(ds);
    expect(await migrate(ds)).toEqual(['AddCardToken1792074000000']);
    expect(await migrate(ds)).toEqual([]);
  });

  it('applies each migration exactly once when instances race', async () => {
    const [a, b] = await Promise.all([open(), open()]);
    await revertLastMigration(a);

    const results = await Promise.all([migrate(a), migrate(b)]);
    expect(results.flat()).toEqual(['AddCardToken1792074000000']);
    expect(await a.showMigrations()).toBe(false);
  });
});
