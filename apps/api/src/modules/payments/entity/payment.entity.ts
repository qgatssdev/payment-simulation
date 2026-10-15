import type {
  CardBrand,
  Currency,
  PaymentFailureCode,
  TransitionActor,
} from '@payment-sim/shared';
import { PaymentStatus, allowedTransitions, canTransition } from '@payment-sim/shared';
import type { VersionedRecord } from '../../../libs/core/base/base.entity';
import { Result } from '../../../libs/core/domain/logic/result';

/** What we keep of a card: enough to show and charge it, never the PAN or CVC. */
export interface PaymentMethod {
  /** The gateway's reference to the card, used by the worker to charge it. Never exposed. */
  token: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** The persisted shape of a payment (what the JSON file holds). */
export interface PaymentData extends VersionedRecord {
  /** Minor units (kobo, cents). */
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  customerEmail: string;
  description: string | null;
  failureCode: PaymentFailureCode | null;
  failureMessage: string | null;
  /** Gateway attempts made so far, including retried ones. */
  attempts: number;
  /** When the payment reached SUCCEEDED or FAILED. */
  processedAt: Date | null;
}

export class Payment implements PaymentData {
  id!: string;
  createdAt!: Date;
  updatedAt!: Date;
  version!: number;
  amount!: number;
  currency!: Currency;
  status!: PaymentStatus;
  paymentMethod!: PaymentMethod;
  customerEmail!: string;
  description!: string | null;
  failureCode!: PaymentFailureCode | null;
  failureMessage!: string | null;
  attempts!: number;
  processedAt!: Date | null;

  static from(data: PaymentData): Payment {
    return Object.assign(new Payment(), data);
  }

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
