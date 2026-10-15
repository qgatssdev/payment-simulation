import type { PaymentStreamMessage } from '@payment-sim/shared';
import type { Logger } from '../../libs/core/logger/logger';

export interface Subscriber {
  /** Only messages for this payment; omit for every payment. */
  paymentId?: string;
  onMessage(message: PaymentStreamMessage): void;
  /** Delivery had a gap (the database listener reconnected): the subscriber should refetch. */
  onResync(): void;
}

/** In-process fan-out from the one database listener to many SSE connections. */
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

  resync(): void {
    for (const subscriber of this.subscribers) this.deliver(() => subscriber.onResync());
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
