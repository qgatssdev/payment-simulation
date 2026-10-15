import type { DataSource, QueryRunner } from 'typeorm';
import { MigrationExecutor } from 'typeorm';

/** Arbitrary but fixed: every process that migrates this database contends for the same lock. */
export const MIGRATION_LOCK_KEY = 7_243_190_001;

/**
 * Apply pending migrations while holding a session-level advisory lock, so two instances
 * booting at once cannot both run them. Migrations execute on the same connection that holds
 * the lock: it needs only one connection (a pool of 1 would otherwise deadlock waiting for a
 * second), and the lock is session-scoped, so this must use a direct connection, not a
 * transaction-mode pooler such as Neon's pooled URL.
 */
export async function migrate(dataSource: DataSource): Promise<string[]> {
  return withMigrationLock(dataSource, async (executor) => {
    const applied = await executor.executePendingMigrations();
    return applied.map((m) => m.name);
  });
}

export async function revertLastMigration(dataSource: DataSource): Promise<void> {
  await withMigrationLock(dataSource, (executor) => executor.undoLastMigration());
}

async function withMigrationLock<T>(
  dataSource: DataSource,
  fn: (executor: MigrationExecutor) => Promise<T>,
): Promise<T> {
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const executor = new MigrationExecutor(dataSource, runner);
      executor.transaction = 'each';
      return await fn(executor);
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await runner.release();
  }
}
