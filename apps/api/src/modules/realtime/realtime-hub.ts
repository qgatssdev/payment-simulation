import type { PaymentStreamMessage } from '@payment-sim/shared';
import type { Logger } from '../../libs/core/logger/logger';

export interface Subscriber {
  /** Only messages for this payment; omit for every payment. */
  paymentId?: string;
  onMessage(message: PaymentStreamMessage): void;
}

/**
 * In-process fan-out of committed payment events to SSE connections. Delivery cannot have
 * gaps: the store publishes after every commit, in the same process that serves the streams.
 */
export class RealtimeHub {
  private readonly subscribers = new Set<Subscriber>();

  constructor(private readonly logger: Logger) {}

  get size(): number {
    return this.subscribers.size;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(message: PaymentStreamMessage): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.paymentId && subscriber.paymentId !== message.payment.id) continue;
      this.deliver(() => subscriber.onMessage(message));
    }
  }

  /** One misbehaving subscriber must not stop delivery to the others. */
  private deliver(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.logger.error({ err }, 'realtime subscriber threw');
    }
  }
}
