import type { Logger as TypeOrmLoggerInterface } from 'typeorm';
import type { Logger } from '../logger/logger';

/** Routes TypeORM's output through pino so queries carry the request/job context too. */
export class TypeOrmPinoLogger implements TypeOrmLoggerInterface {
  constructor(private readonly logger: Logger) {}

  logQuery(query: string, parameters?: unknown[]): void {
    // Parameters may hold customer data; only the statement is logged, and only at trace.
    this.logger.trace({ query, parameterCount: parameters?.length ?? 0 }, 'db query');
  }

  logQueryError(error: string | Error, query: string): void {
    this.logger.error({ err: error, query }, 'db query failed');
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn({ durationMs: time, query }, 'slow db query');
  }

  logSchemaBuild(message: string): void {
    this.logger.debug({ schema: message }, 'db schema build');
  }

  logMigration(message: string): void {
    this.logger.info({ migration: message }, 'db migration');
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    this.logger[level === 'warn' ? 'warn' : 'info']({ detail: message }, 'typeorm');
  }
}
