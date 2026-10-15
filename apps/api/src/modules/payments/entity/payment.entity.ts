import type {
  CardBrand,
  Currency,
  PaymentFailureCode,
  TransitionActor,
} from '@payment-sim/shared';
import { PaymentStatus, allowedTransitions, canTransition } from '@payment-sim/shared';
import { Check, Column, Entity, Index } from 'typeorm';
import { VersionedEntity } from '../../../libs/core/base/base.entity';
import { Result } from '../../../libs/core/domain/logic/result';
import { bigintTransformer } from '../../../libs/core/db/transformers';

/** What we keep of a card: enough to show and reason about it, never the PAN or CVC. */
export class PaymentMethod {
  @Column({ type: 'varchar', length: 20 })
  brand!: CardBrand;

  @Column({ type: 'char', length: 4 })
  last4!: string;

  @Column({ type: 'smallint' })
  expMonth!: number;

  @Column({ type: 'smallint' })
  expYear!: number;
}

@Entity('payments')
// Keyset pagination: newest first, with id as the tie-breaker for equal timestamps.
@Index('idx_payments_created_at_id', ['createdAt', 'id'])
@Index('idx_payments_status_created_at_id', ['status', 'createdAt', 'id'])
@Check('chk_payments_amount_positive', '"amount" > 0')
export class Payment extends VersionedEntity {
  /** Minor units (kobo, cents). */
  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount!: number;

  @Column({ type: 'char', length: 3 })
  currency!: Currency;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column(() => PaymentMethod, { prefix: 'card' })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'varchar', length: 254 })
  customerEmail!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  failureCode!: PaymentFailureCode | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureMessage!: string | null;

  /** Gateway attempts made so far, including retried ones. */
  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  /** When the payment reached SUCCEEDED or FAILED. */
  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  /**
   * Apply a lifecycle transition in memory, if the shared state machine allows it for this
   * actor. An illegal transition is an expected outcome (a client cancelling a payment that
   * already moved on), so it is returned as a failed Result rather than thrown; the caller
   * decides what it means. Persisting the change is the repository's job.
   */
  transitionTo(
    to: PaymentStatus,
    actor: TransitionActor,
    now: Date = new Date(),
  ): Result<StatusChange, TransitionRejection> {
    const from = this.status;
    if (!canTransition(from, to, actor)) {
      return Result.fail({ from, to, allowed: allowedTransitions(from, actor) });
    }
    this.status = to;
    if (to === PaymentStatus.SUCCEEDED || to === PaymentStatus.FAILED) {
      this.processedAt = now;
    }
    return Result.ok({ from, to });
  }
}

export interface StatusChange {
  from: PaymentStatus;
  to: PaymentStatus;
}

export interface TransitionRejection extends StatusChange {
  /** What this actor could move the payment to instead. */
  allowed: PaymentStatus[];
}
