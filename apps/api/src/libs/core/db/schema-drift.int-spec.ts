import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../../test/database';
import { migrate, revertLastMigration } from './migrator';

/**
 * The schema is owned by hand-written migrations; the entities describe it for TypeORM.
 * If the two disagree (a column added to an entity but not a migration, a changed default,
 * a renamed index), TypeORM's schema builder would emit DDL to reconcile them. This test
 * asserts it would emit nothing.
 */
async function pendingSchemaChanges(dataSource: DataSource): Promise<string[]> {
  const sql = await dataSource.driver.createSchemaBuilder().log();
  return sql.upQueries.map((q) => q.query);
}

describe('schema drift', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('entities match the migrated schema exactly', async () => {
    expect(await pendingSchemaChanges(dataSource)).toEqual([]);
  });

  it('has no pending migrations', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
  });

  it('migrations revert cleanly and re-apply to the same schema', async () => {
    await revertLastMigration(dataSource);
    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'typeorm_migrations'`,
    );
    expect(tables).toEqual([]);

    expect(await migrate(dataSource)).toEqual(['InitialSchema1792067376000']);
    expect(await pendingSchemaChanges(dataSource)).toEqual([]);
  });
});
