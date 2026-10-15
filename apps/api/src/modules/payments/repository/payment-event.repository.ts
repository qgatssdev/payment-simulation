import { randomUUID } from 'node:crypto';
import type { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { PaymentStore, StoreTx } from '../../../infra/store/payment-store';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import type { PaymentEvent } from '../entity/payment-event.entity';

export interface NewPaymentEvent {
  paymentId: string;
  type: PaymentEventType;
  fromStatus?: PaymentStatus | null;
  toStatus?: PaymentStatus | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

const SEQUENCE = 'paymentEvents';
const bySequence = (a: PaymentEvent, b: PaymentEvent) => a.sequence - b.sequence;

export class PaymentEventRepository extends BaseRepository<'paymentEvents'> {
  constructor(store: PaymentStore, tx?: StoreTx) {
    super(store, 'paymentEvents', tx);
  }

  /** The sequence is drawn inside the same transaction, so it commits or rolls back with it. */
  append(event: NewPaymentEvent): Promise<PaymentEvent> {
    return this.write((tx) => {
      const record: PaymentEvent = {
        id: randomUUID(),
        sequence: tx.nextSequence(SEQUENCE),
        createdAt: this.now(),
        fromStatus: null,
        toStatus: null,
        reason: null,
        metadata: {},
        ...event,
      };
      tx.put('paymentEvents', record);
      return record;
    });
  }

  listForPayment(paymentId: string): Promise<PaymentEvent[]> {
    return Promise.resolve(
      this.reader
        .find('paymentEvents', (e) => e.paymentId === paymentId)
        .sort(bySequence),
    );
  }

  /** Events after a sequence number, oldest first: the replay for a resuming stream. */
  listAfter(
    afterSequence: number,
    limit: number,
    paymentId?: string,
  ): Promise<PaymentEvent[]> {
    return Promise.resolve(
      this.reader
        .find(
          'paymentEvents',
          (e) => e.sequence > afterSequence && (!paymentId || e.paymentId === paymentId),
        )
        .sort(bySequence)
        .slice(0, limit),
    );
  }
}
