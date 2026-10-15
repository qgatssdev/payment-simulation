import { ServiceUnavailableError } from '../errors/app-error';

/** The data file exists but cannot be trusted; startup stops rather than overwrite it. */
export class StoreLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StoreLoadError';
  }
}

/** Another live process owns the data file. */
export class StoreLockedError extends Error {
  constructor(file: string, pid: number) {
    super(`${file} is in use by process ${pid}; only one process may write it`);
    this.name = 'StoreLockedError';
  }
}

/**
 * A committed change could not be written to disk. It stays in memory and is written by the
 * next successful flush, so the client cannot know whether it persisted: retrying with the
 * same idempotency key is the safe response, which is what 503 + Retry-After invites.
 */
export class StorageUnavailableError extends ServiceUnavailableError {
  constructor(options?: ErrorOptions) {
    super('Storage is temporarily unavailable, please retry', 1, options);
  }
}
