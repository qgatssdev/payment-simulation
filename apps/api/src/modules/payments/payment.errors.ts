import { ErrorCode, HEADERS } from '@payment-sim/shared';
import { AppError, ConflictError, PreconditionFailedError } from '../../libs/core/errors';
import type { TransitionRejection } from './entity/payment.entity';

export class InvalidStateTransitionError extends ConflictError {
  constructor({ from, to, allowed }: TransitionRejection) {
    super(`Cannot move a ${from} payment to ${to}`, ErrorCode.INVALID_STATE_TRANSITION, {
      from,
      to,
      allowed,
    });
  }
}

/** Lost an optimistic-locking race repeatedly; the client can safely retry. */
export class ConcurrentModificationError extends ConflictError {
  constructor(paymentId: string) {
    super(
      `Payment ${paymentId} is being modified concurrently, please retry`,
      ErrorCode.CONCURRENT_MODIFICATION,
    );
  }
}

export class StalePaymentVersionError extends PreconditionFailedError {
  constructor(expected: number, current: number) {
    super(
      `${HEADERS.IF_MATCH} expected version ${expected} but the payment is at version ${current}`,
      { expectedVersion: expected, currentVersion: current },
    );
  }
}

export class IdempotencyKeyRequiredError extends AppError {
  constructor() {
    super(
      ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      400,
      `The ${HEADERS.IDEMPOTENCY_KEY} header is required to create a payment`,
    );
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(key: string) {
    super(
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      422,
      `${HEADERS.IDEMPOTENCY_KEY} "${key}" was already used for a different request`,
    );
  }
}
