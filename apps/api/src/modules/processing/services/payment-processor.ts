import { PaymentFailureCode, PaymentStatus } from '@payment-sim/shared';
import type {
  ChargeResult,
  PaymentGateway,
} from '../../../infra/gateway/payment-gateway';
import { GatewayError } from '../../../infra/gateway/payment-gateway';
import type { Logger } from '../../../libs/core/logger/logger';
import type { Payment } from '../../payments/entity/payment.entity';
import { InvalidStateTransitionError } from '../../payments/payment.errors';
import type { PaymentService } from '../../payments/services/payment.service';
import type { BackoffPolicy } from '../backoff';
import { backoffDelay } from '../backoff';
import type { Job } from '../entity/job.entity';

export type JobOutcome =
  /** The payment reached a final state, or there was nothing left to do. */
  | { kind: 'done'; detail: string }
  /** A retryable gateway failure; run the job again after `delayMs`. */
  | { kind: 'retry'; delayMs: number; error: string };

interface Failure {
  code: PaymentFailureCode;
  message: string;
  retryable: boolean;
}

export interface PaymentProcessorDeps {
  payments: PaymentService;
  gateway: PaymentGateway;
  logger: Logger;
  gatewayTimeoutMs: number;
  backoff: BackoffPolicy;
  clock?: () => Date;
  random?: () => number;
}

/**
 * What one processing job means for its payment. Safe to run more than once for the same
 * payment (after a crash, a reclaimed lock, a retry): it re-reads the payment, skips work that
 * is already done, and charges with the payment id as the gateway idempotency key, so a
 * re-run can never take the money twice.
 */
export class PaymentProcessor {
  private readonly clock: () => Date;
  private readonly random: () => number;

  constructor(private readonly deps: PaymentProcessorDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.random = deps.random ?? Math.random;
  }

  async process(job: Job): Promise<JobOutcome> {
    const payment = await this.deps.payments.get(job.paymentId);

    if (payment.status === PaymentStatus.PENDING) {
      try {
        await this.deps.payments.transition(
          payment.id,
          PaymentStatus.PROCESSING,
          'system',
          {
            metadata: { attempt: job.attempts },
          },
        );
      } catch (err) {
        // Cancelled (or otherwise moved) between enqueue and now: nothing to charge.
        if (err instanceof InvalidStateTransitionError) {
          return { kind: 'done', detail: 'payment is no longer pending' };
        }
        throw err;
      }
    } else if (payment.status !== PaymentStatus.PROCESSING) {
      return { kind: 'done', detail: `payment already ${payment.status}` };
    }

    let result: ChargeResult;
    try {
      result = await this.charge(payment, job.attempts);
    } catch (err) {
      return this.handleFailure(payment, job, this.classify(err));
    }

    if (result.status === 'approved') {
      await this.deps.payments.transition(payment.id, PaymentStatus.SUCCEEDED, 'system', {
        reason: 'Approved by the gateway',
        metadata: {
          attempt: job.attempts,
          authorizationCode: result.authorizationCode,
          latencyMs: result.latencyMs,
        },
        mutate: (p) => {
          p.attempts = job.attempts;
        },
      });
      return { kind: 'done', detail: 'approved' };
    }

    await this.markFailed(
      payment.id,
      job.attempts,
      {
        code: result.code,
        message: result.message,
        retryable: false,
      },
      { latencyMs: result.latencyMs },
    );
    return { kind: 'done', detail: `declined: ${result.code}` };
  }

  private async charge(payment: Payment, attempt: number): Promise<ChargeResult> {
    const deadline = AbortSignal.timeout(this.deps.gatewayTimeoutMs);
    try {
      return await this.deps.gateway.charge(
        {
          token: payment.paymentMethod.token,
          amount: payment.amount,
          currency: payment.currency,
          idempotencyKey: payment.id,
          attempt,
        },
        deadline,
      );
    } catch (err) {
      // Whatever the gateway threw on abort, the cause is our deadline.
      if (deadline.aborted) {
        throw new GatewayError(
          PaymentFailureCode.GATEWAY_TIMEOUT,
          `Gateway did not respond within ${this.deps.gatewayTimeoutMs}ms`,
          true,
          { cause: err },
        );
      }
      throw err;
    }
  }

  private classify(err: unknown): Failure {
    if (err instanceof GatewayError) {
      return { code: err.code, message: err.message, retryable: err.retryable };
    }
    // Not a gateway answer at all (a bug, storage): let the worker's crash handling decide.
    throw err;
  }

  private async handleFailure(
    payment: Payment,
    job: Job,
    failure: Failure,
  ): Promise<JobOutcome> {
    if (!failure.retryable || job.attempts >= job.maxAttempts) {
      const message = failure.retryable
        ? `${failure.message}; gave up after ${job.attempts} attempts`
        : failure.message;
      await this.markFailed(payment.id, job.attempts, { ...failure, message });
      return { kind: 'done', detail: `failed: ${failure.code}` };
    }

    const delayMs = backoffDelay(job.attempts, this.deps.backoff, this.random);
    await this.deps.payments.recordFailedAttempt(payment.id, {
      attempt: job.attempts,
      code: failure.code,
      message: failure.message,
      retryAt: new Date(this.clock().getTime() + delayMs),
    });
    this.deps.logger.warn(
      { code: failure.code, attempt: job.attempts, delayMs },
      'gateway attempt failed, retrying',
    );
    return { kind: 'retry', delayMs, error: failure.message };
  }

  private markFailed(
    paymentId: string,
    attempts: number,
    failure: Failure,
    metadata: Record<string, unknown> = {},
  ): Promise<Payment> {
    return this.deps.payments.transition(paymentId, PaymentStatus.FAILED, 'system', {
      reason: failure.message,
      metadata: { attempt: attempts, code: failure.code, ...metadata },
      mutate: (p) => {
        p.attempts = attempts;
        p.failureCode = failure.code;
        p.failureMessage = failure.message.slice(0, 255);
      },
    });
  }
}
