import type { Express } from 'express';
import { createApp } from '../app';
import type { Container, ContainerOverrides } from '../container';
import { createContainer } from '../container';
import type { PaymentCollections, PaymentStore } from '../infra/store/payment-store';
import { openPaymentStore } from '../infra/store/payment-store';
import { createLogger } from '../libs/core/logger/logger';
import type { SnapshotWriter } from '../libs/core/store/json-file';
import { testConfig } from './helpers';

const silent = () => createLogger({ level: 'silent', pretty: false });

/** A fresh store: in memory, or on `file` (tests that exercise persistence pass a temp path). */
export function createTestStore(
  options: { file?: string; writer?: SnapshotWriter; clock?: () => Date } = {},
): Promise<PaymentStore> {
  return openPaymentStore({ logger: silent(), ...options });
}

const openContainers: Container[] = [];

/**
 * The real app on the real object graph — the same createContainer wiring production uses —
 * over the given store. Several apps may share one store, like workers sharing a data file.
 */
export async function createTestApp(
  store: PaymentStore,
  overrides: Omit<ContainerOverrides, 'store'> = {},
  env: NodeJS.ProcessEnv = {},
): Promise<{ app: Express; container: Container }> {
  const config = testConfig({
    RATE_LIMIT_MAX: '10000',
    RATE_LIMIT_WRITE_MAX: '10000',
    ...env,
  });
  const container = await createContainer(config, silent(), { ...overrides, store });
  openContainers.push(container);
  return { app: createApp(container), container };
}

/** Stop every test app's worker and streams (the stores themselves are the tests' to close). */
export async function closeTestApps(): Promise<void> {
  await Promise.all(openContainers.splice(0).map((c) => c.shutdown()));
}

/** Change stored records directly, bypassing services: for arranging test states. */
export function patchRecord<K extends keyof PaymentCollections>(
  store: PaymentStore,
  collection: K,
  key: string,
  changes: Partial<PaymentCollections[K]>,
): Promise<void> {
  return store.transaction((tx) => {
    const current = tx.get(collection, key);
    if (!current) throw new Error(`No ${String(collection)} record ${key}`);
    tx.put(collection, { ...current, ...changes });
  });
}
