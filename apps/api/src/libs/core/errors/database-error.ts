import type { AppError } from './app-error';
import { ConflictError, ServiceUnavailableError } from './app-error';

/**
 * Postgres SQLSTATE codes we react to (https://www.postgresql.org/docs/current/errcodes-appendix.html).
 * The nest-template matched MSSQL error numbers (547, 2627); these are their Postgres equivalents
 * plus the transient classes a payment service has to treat as retryable.
 */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  ADMIN_SHUTDOWN: '57P01',
  CANNOT_CONNECT_NOW: '57P03',
  TOO_MANY_CONNECTIONS: '53300',
} as const;

const TRANSIENT_SQLSTATES = new Set<string>([
  PG.SERIALIZATION_FAILURE,
  PG.DEADLOCK_DETECTED,
  PG.LOCK_NOT_AVAILABLE,
  PG.QUERY_CANCELED,
  PG.ADMIN_SHUTDOWN,
  PG.CANNOT_CONNECT_NOW,
  PG.TOO_MANY_CONNECTIONS,
]);

const NETWORK_ERRNOS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
]);

/** TypeORM wraps driver errors (QueryFailedError.driverError); look through the wrapper. */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = (error as { driverError?: unknown }).driverError ?? error;
  const code = (candidate as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Translate infrastructure failures into client-meaningful errors. Returns undefined for
 * anything unrecognised so the caller falls back to a generic 500. Integrity violations other
 * than uniqueness (FK, check, not-null) are not mapped: they mean the service sent bad data,
 * which is our bug, not the client's.
 */
export function mapDatabaseError(error: unknown): AppError | undefined {
  const code = sqlStateOf(error);
  if (code === undefined) return undefined;

  if (code === PG.UNIQUE_VIOLATION) {
    return new ConflictError('The resource already exists', undefined, undefined, {
      cause: error,
    });
  }
  // Class 08 = connection exceptions.
  if (
    TRANSIENT_SQLSTATES.has(code) ||
    code.startsWith('08') ||
    NETWORK_ERRNOS.has(code)
  ) {
    return new ServiceUnavailableError(undefined, 1, { cause: error });
  }
  return undefined;
}
