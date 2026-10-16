import type { SnapshotWriter } from '../../libs/core/store/json-file';
import type { Transaction } from '../../libs/core/store/json-store';
import { JsonStore } from '../../libs/core/store/json-store';
import type { Logger } from '../../libs/core/logger/logger';
import type { IdempotencyKey } from '../../modules/payments/entity/idempotency-key.entity';
import type { PaymentEvent } from '../../modules/payments/entity/payment-event.entity';
import type { PaymentData } from '../../modules/payments/entity/payment.entity';
import type { Job } from '../../modules/processing/entity/job.entity';

/** Everything the service persists, one collection per aggregate. */
export interface PaymentCollections {
  payments: PaymentData;
  paymentEvents: PaymentEvent;
  idempotencyKeys: IdempotencyKey;
  jobs: Job;
}

export type PaymentStore = JsonStore<PaymentCollections>;
export type StoreTx = Transaction<PaymentCollections>;

/** Bump when the file layout changes incompatibly; older files are then refused, not misread. */
export const STORE_FORMAT = 'payment-simulation/v1';

export interface OpenPaymentStoreOptions {
  /** JSON data file; omit or leave empty for in-memory only. */
  file?: string;
  logger: Logger;
  clock?: () => Date;
  writer?: SnapshotWriter;
}

export function openPaymentStore({
  file,
  logger,
  clock,
  writer,
}: OpenPaymentStoreOptions): Promise<PaymentStore> {
  return JsonStore.open<PaymentCollections>({
    format: STORE_FORMAT,
    file: file || undefined,
    logger,
    clock,
    writer,
    collections: {
      payments: { key: 'id', dates: ['createdAt', 'updatedAt', 'processedAt'] },
      paymentEvents: { key: 'id', dates: ['createdAt'] },
      idempotencyKeys: {
        key: 'key',
        dates: ['createdAt', 'expiresAt', 'lastReplayedAt'],
      },
      jobs: {
        key: 'id',
        dates: ['createdAt', 'updatedAt', 'runAt', 'lockedAt', 'completedAt'],
      },
    },
  });
}
