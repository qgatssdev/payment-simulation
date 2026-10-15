import type { PaymentStreamMessage } from '@payment-sim/shared';
import type { EntityManager } from 'typeorm';
import { CHANNELS, MAX_NOTIFY_PAYLOAD_BYTES } from './channels';

export interface PaymentEventPublisher {
  paymentEvent(manager: EntityManager, message: PaymentStreamMessage): Promise<void>;
  jobEnqueued(manager: EntityManager): Promise<void>;
}

/**
 * Publishes through Postgres NOTIFY on the caller's transaction. Postgres delivers
 * notifications only when that transaction commits (and drops them on rollback), so a
 * subscriber can never see an event that did not happen — no outbox table needed.
 */
export class PgNotifyPublisher implements PaymentEventPublisher {
  async paymentEvent(
    manager: EntityManager,
    message: PaymentStreamMessage,
  ): Promise<void> {
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_NOTIFY_PAYLOAD_BYTES) {
      // Every field is length-bounded, so this is a bug; fail the transaction loudly.
      throw new Error(
        `Stream message for ${message.payment.id} exceeds the NOTIFY limit`,
      );
    }
    await manager.query('SELECT pg_notify($1, $2)', [CHANNELS.PAYMENT_EVENTS, payload]);
  }

  async jobEnqueued(manager: EntityManager): Promise<void> {
    await manager.query('SELECT pg_notify($1, $2)', [CHANNELS.JOBS_ENQUEUED, '']);
  }
}
