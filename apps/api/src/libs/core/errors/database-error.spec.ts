import { ErrorCode } from '@payment-sim/shared';
import { ConflictError, ServiceUnavailableError } from './app-error';
import { PG, mapDatabaseError, sqlStateOf } from './database-error';

const pgError = (code: string) => Object.assign(new Error('pg'), { code });
/** Shape of TypeORM's QueryFailedError: the driver error sits under driverError. */
const typeormError = (code: string) =>
  Object.assign(new Error('query failed'), { driverError: pgError(code) });

describe('sqlStateOf', () => {
  it('reads the code from a driver error or through a TypeORM wrapper', () => {
    expect(sqlStateOf(pgError('23505'))).toBe('23505');
    expect(sqlStateOf(typeormError('40001'))).toBe('40001');
  });

  it.each([null, undefined, 'boom', 42, new Error('plain'), { code: 7 }])(
    'returns undefined for %p',
    (value) => expect(sqlStateOf(value)).toBeUndefined(),
  );
});

describe('mapDatabaseError', () => {
  it('maps a unique violation to 409 and keeps the cause', () => {
    const cause = typeormError(PG.UNIQUE_VIOLATION);
    const mapped = mapDatabaseError(cause);
    expect(mapped).toBeInstanceOf(ConflictError);
    expect(mapped).toMatchObject({ status: 409, code: ErrorCode.CONFLICT, cause });
  });

  it.each([
    PG.SERIALIZATION_FAILURE,
    PG.DEADLOCK_DETECTED,
    PG.LOCK_NOT_AVAILABLE,
    PG.ADMIN_SHUTDOWN,
    PG.TOO_MANY_CONNECTIONS,
    '08006',
    '08001',
    'ECONNREFUSED',
    'ETIMEDOUT',
  ])('treats %s as transient (503)', (code) => {
    const mapped = mapDatabaseError(pgError(code));
    expect(mapped).toBeInstanceOf(ServiceUnavailableError);
    expect(mapped).toMatchObject({ status: 503, retryAfterSeconds: 1 });
  });

  it.each(['23503', '23502', '22P02', '42P01'])(
    'leaves %s unmapped: it is a server bug, not a client error',
    (code) => expect(mapDatabaseError(pgError(code))).toBeUndefined(),
  );

  it('ignores errors without a code', () => {
    expect(mapDatabaseError(new Error('nope'))).toBeUndefined();
  });
});
