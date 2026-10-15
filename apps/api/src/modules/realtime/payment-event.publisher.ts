import type { PaymentStreamMessage } from '@payment-sim/shared';
import type { StoreTx } from '../../infra/store/payment-store';
import type { RealtimeHub } from './realtime-hub';

export interface PaymentEventPublisher {
  paymentEvent(tx: StoreTx, message: PaymentStreamMessage): void;
  jobEnqueued(tx: StoreTx): void;
}

/**
 * Publishes as an after-commit hook of the caller's transaction: subscribers hear about a
 * change only once it is committed and durable, and never about one that rolled back.
 */
export class AfterCommitPublisher implements PaymentEventPublisher {
  constructor(
    private readonly hub: RealtimeHub,
    private readonly wakeWorker: () => void,
  ) {}

  paymentEvent(tx: StoreTx, message: PaymentStreamMessage): void {
    tx.afterCommit(() => this.hub.publish(message));
  }

  jobEnqueued(tx: StoreTx): void {
    tx.afterCommit(this.wakeWorker);
  }
}
