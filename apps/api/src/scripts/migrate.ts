import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { ConfigError, loadConfig } from '../config';
import { createDataSource } from '../libs/core/db/data-source';
import { migrate, revertLastMigration } from '../libs/core/db/migrator';
import { createLogger } from '../libs/core/logger/logger';

if (existsSync('.env')) process.loadEnvFile('.env');

/** Usage: migrate            apply pending migrations
 *         migrate --revert   undo the most recent one */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });
  const dataSource = createDataSource({
    url: config.databaseUrlUnpooled,
    logger,
    poolMax: 1,
    // DDL can legitimately run longer than an API query.
    statementTimeoutMs: 0,
  });

  try {
    await dataSource.initialize();
    if (process.argv.includes('--revert')) {
      await revertLastMigration(dataSource);
      logger.info('reverted the last migration');
    } else {
      const applied = await migrate(dataSource);
      logger.info(
        { applied },
        applied.length ? 'migrations applied' : 'schema already up to date',
      );
    }
  } catch (err) {
    logger.fatal({ err }, 'migration failed');
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main();
