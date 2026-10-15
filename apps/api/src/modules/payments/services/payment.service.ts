import type {
  ApiSuccess,
  CreatePaymentDto,
  PaymentStatus,
  PaymentView,
  TransitionActor,
  UpdatePaymentStatusDto,
} from '@payment-sim/shared';
import { PaymentEventType, detectCardBrand } from '@payment-sim/shared';
import type { DataSource, EntityManager } from 'typeorm';
import { BaseResponse } from '../../../libs/core/base/base.response';
import { NotFoundError } from '../../../libs/core/errors';
import type { Logger } from '../../../libs/core/logger/logger';
import { requestContext } from '../../../libs/core/logger/request-context';
import type { JobRepository } from '../../processing/repository/job.repository';
import type { Payment } from '../entity/payment.entity';
import { toPaymentView } from '../mappers/payment.mapper';
import {
  ConcurrentModificationError,
  IdempotencyKeyReusedError,
  InvalidStateTransitionError,
  StalePaymentVersionError,
} from '../payment.errors';
import type { IdempotencyKeyRepository } from '../repository/idempotency-key.repository';
import type { PaymentEventRepository } from '../repository/payment-event.repository';
import type { PaymentRepository } from '../repository/payment.repository';
import { fingerprintCreatePayment } from './request-fingerprint';

export interface PaymentServiceDeps {
  dataSource: DataSource;
  payments: PaymentRepository;
  events: PaymentEventRepository;
  jobs: JobRepository;
  idempotencyKeys: IdempotencyKeyRepository;
  logger: Logger;
  clock?: () => Date;
  idempotencyTtlMs?: number;
  /** Optimistic-lock retries before giving up with 409 CONCURRENT_MODIFICATION. */
  maxTransitionAttempts?: number;
}

export interface CreatePaymentOutcome {
  statusCode: number;
  body: ApiSuccess<PaymentView>;
  /** True when this is a stored response replayed for a repeated idempotency key. */
  replayed: boolean;
}

export interface TransitionOptions {
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** From If-Match: fail with 412 instead of retrying when the payment has moved on. */
  expectedVersion?: number;
  /** Extra changes to apply with the transition (failure details, attempt count). */
  mutate?: (payment: Payment) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class PaymentService {
  private readonly clock: () => Date;
  private readonly idempotencyTtlMs: number;
  private readonly maxTransitionAttempts: number;

  constructor(private readonly deps: PaymentServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.idempotencyTtlMs = deps.idempotencyTtlMs ?? DAY_MS;
    this.maxTransitionAttempts = deps.maxTransitionAttempts ?? 3;
  }

  /**
   * Accept a payment for asynchronous processing. In one transaction: claim the idempotency
   * key, insert the payment, its `created` event and its processing job, and store the
   * response under the key. Either all of it commits or none of it does.
   */
  async create(
    dto: CreatePaymentDto,
    idempotencyKey: string,
  ): Promise<CreatePaymentOutcome> {
    const requestHash = fingerprintCreatePayment(dto);
    const now = this.clock();

    return this.deps.dataSource.transaction(async (manager) => {
      const keys = this.deps.idempotencyKeys.withTransaction(manager);
      const claim = await keys.claim(
        idempotencyKey,
        requestHash,
        now,
        new Date(now.getTime() + this.idempotencyTtlMs),
      );

      if (!claim.claimed) {
        if (claim.existing.requestHash !== requestHash) {
          throw new IdempotencyKeyReusedError(idempotencyKey);
        }
        this.deps.logger.info(
          { idempotencyKey, paymentId: claim.existing.paymentId },
          'replaying idempotent response',
        );
        return {
          statusCode: claim.existing.responseStatus ?? 202,
          body: claim.existing.responseBody as ApiSuccess<PaymentView>,
          replayed: true,
        };
      }

      const payments = this.deps.payments.withTransaction(manager);
      const payment = await payments.save(
        payments.create({
          amount: dto.amount,
          currency: dto.currency,
          customerEmail: dto.customerEmail,
          description: dto.description ?? null,
          paymentMethod: {
            brand: detectCardBrand(dto.card.number),
            last4: dto.card.number.slice(-4),
            expMonth: dto.card.expMonth,
            expYear: dto.card.expYear,
          },
        }),
      );
      await this.deps.events.withTransaction(manager).append({
        paymentId: payment.id,
        type: PaymentEventType.CREATED,
        toStatus: payment.status,
        metadata: { amount: payment.amount, currency: payment.currency, ...this.trace() },
      });
      await this.deps.jobs.withTransaction(manager).enqueuePaymentProcessing(payment.id);

      const body = BaseResponse.success(
        toPaymentView(payment),
        'Payment accepted for processing',
      );
      await keys.complete(idempotencyKey, { status: 202, body, paymentId: payment.id });

      this.deps.logger.info(
        { paymentId: payment.id, amount: payment.amount, currency: payment.currency },
        'payment accepted',
      );
      return { statusCode: 202, body, replayed: false };
    });
  }

  async get(id: string): Promise<Payment> {
    const payment = await this.deps.payments.findById(id);
    if (!payment) throw NotFoundError.resource('Payment', id);
    return payment;
  }

  /** Client-initiated change (cancel, refund) via PATCH /payments/:id/status. */
  updateStatus(
    id: string,
    dto: UpdatePaymentStatusDto,
    expectedVersion?: number,
  ): Promise<Payment> {
    return this.transition(id, dto.status, 'client', {
      reason: dto.reason ?? null,
      expectedVersion,
    });
  }

  /**
   * The one way a payment's status changes, for clients and the worker alike.
   *
   * Read → validate against the state machine → write only if the version is unchanged, with
   * the audit event in the same transaction. No row lock is held while deciding. If another
   * writer wins the race, re-read and re-validate: a cancel that loses to the worker moving
   * the payment to PROCESSING is then correctly rejected as an invalid transition, rather
   * than overwriting it. With If-Match the caller asked for "this exact version", so a moved
   * payment is a 412 instead of a retry.
   */
  async transition(
    id: string,
    to: PaymentStatus,
    actor: TransitionActor,
    options: TransitionOptions = {},
  ): Promise<Payment> {
    for (let attempt = 1; ; attempt++) {
      const payment = await this.get(id);
      const readVersion = payment.version;

      if (
        options.expectedVersion !== undefined &&
        options.expectedVersion !== readVersion
      ) {
        throw new StalePaymentVersionError(options.expectedVersion, readVersion);
      }

      const change = payment.transitionTo(to, actor, this.clock());
      if (change.isFailure) throw new InvalidStateTransitionError(change.errorValue());
      options.mutate?.(payment);

      const { from } = change.getValue();
      const saved = await this.deps.dataSource.transaction((manager) =>
        this.persistTransition(manager, payment, from, readVersion, actor, options),
      );
      if (saved) {
        this.deps.logger.info(
          { paymentId: id, from, to, actor, version: saved.version },
          'payment status changed',
        );
        return saved;
      }

      if (options.expectedVersion !== undefined) {
        const current = await this.get(id);
        throw new StalePaymentVersionError(options.expectedVersion, current.version);
      }
      if (attempt >= this.maxTransitionAttempts)
        throw new ConcurrentModificationError(id);
      this.deps.logger.debug(
        { paymentId: id, attempt },
        'lost optimistic lock race, retrying',
      );
    }
  }

  private async persistTransition(
    manager: EntityManager,
    payment: Payment,
    fromStatus: PaymentStatus,
    readVersion: number,
    actor: TransitionActor,
    options: TransitionOptions,
  ): Promise<Payment | null> {
    const saved = await this.deps.payments
      .withTransaction(manager)
      .updateIfVersion(payment, readVersion);
    if (!saved) return null;

    await this.deps.events.withTransaction(manager).append({
      paymentId: payment.id,
      type: PaymentEventType.STATUS_CHANGED,
      fromStatus,
      toStatus: saved.status,
      reason: options.reason ?? null,
      metadata: { actor, ...this.trace(), ...options.metadata },
    });
    return saved;
  }

  private trace(): Record<string, string> {
    const requestId = requestContext.requestId();
    return requestId ? { requestId } : {};
  }
}
