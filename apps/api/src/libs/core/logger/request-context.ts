import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Correlation fields that follow an async flow (an HTTP request, a worker job) through every
 * await without being passed by hand. The logger's mixin reads this, so any log line written
 * inside the flow — controller, service, repository — carries the same requestId / jobId.
 */
export type LogContext = Readonly<Record<string, string | number>>;

const storage = new AsyncLocalStorage<LogContext>();

export const requestContext = {
  run<T>(context: LogContext, fn: () => T): T {
    return storage.run({ ...storage.getStore(), ...context }, fn);
  },

  get(): LogContext {
    return storage.getStore() ?? {};
  },

  requestId(): string | undefined {
    const id = storage.getStore()?.requestId;
    return typeof id === 'string' ? id : undefined;
  },
};
