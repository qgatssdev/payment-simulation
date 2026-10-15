import type { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { EntityManager } from 'typeorm';
import { MoreThan } from 'typeorm';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { PaymentEvent } from '../entity/payment-event.entity';

export interface NewPaymentEvent {
  paymentId: string;
  type: PaymentEventType;
  fromStatus?: PaymentStatus | null;
  toStatus?: PaymentStatus | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export class PaymentEventRepository extends BaseRepository<PaymentEvent> {
  constructor(manager: EntityManager) {
    super(manager.getRepository(PaymentEvent));
  }

  append(event: NewPaymentEvent): Promise<PaymentEvent> {
    return this.save(
      this.create({
        fromStatus: null,
        toStatus: null,
        reason: null,
        metadata: {},
        ...event,
      }),
    );
  }

  listForPayment(paymentId: string): Promise<PaymentEvent[]> {
    return this.repository.find({ where: { paymentId }, order: { sequence: 'ASC' } });
  }

  /** Events after a sequence number, oldest first: the replay for a resuming stream. */
  listAfter(
    afterSequence: number,
    limit: number,
    paymentId?: string,
  ): Promise<PaymentEvent[]> {
    return this.repository.find({
      where: { sequence: MoreThan(afterSequence), ...(paymentId ? { paymentId } : {}) },
      order: { sequence: 'ASC' },
      take: limit,
    });
  }
}
