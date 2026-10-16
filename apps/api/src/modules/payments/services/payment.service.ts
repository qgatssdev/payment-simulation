import type {
  ApiSuccess,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PaymentStreamMessage,
  StatsView,
  PaymentFailureCode,
  PaymentView,
  TransitionActor,
  UpdatePaymentStatusDto,
} from '@payment-sim/shared';
import {
  DEFAULT_PAGE_LIMIT,
  ErrorCode,
  PAYMENT_STATUSES,
  PaymentEventType,
  PaymentStatus,
} from '@payment-sim/shared';
import type { PaymentGateway } from '../../../infra/gateway/payment-gateway';
import type { PaymentStore } from '../../../infra/store/payment-store';
import { decodeCursor, encodeCursor } from '../../../libs/common/http/cursor';
import { BaseResponse } from '../../../libs/core/base/base.response';
import { ConflictError, NotFoundError } from '../../../libs/core/errors';
import type { Logger } from '../../../libs/core/logger/logger';
import { requestContext } from '../../../libs/core/logger/request-context';
import type { JobRepository } from '../../processing/repository/job.repository';
import type { PaymentEventPublisher } from '../../realtime/payment-event.publisher';
import type { IdempotencyKey } from '../entity/idempotency-key.entity';
import type { PaymentEvent } from '../entity/payment-event.entity';
import type { Payment } from '../entity/payment.entity';
import { toPaymentView, toStreamMessage } from '../mappers/payment.mapper';
import {
  ConcurrentModificationError,
  IdempotencyKeyReusedError,
  InvalidStateTransitionError,
  StalePaymentVersionError,
} from '../payment.errors';
import type { IdempotencyKeyRepository } from '../repository/idempotency-key.repository';
import type {
  NewPaymentEvent,
  PaymentEventRepository,
} from '../repository/payment-event.repository';
import type { PaymentRepository } from '../repository/payment.repository';
import { fingerprintCreatePayment } from './request-fingerprint';

export interface PaymentServiceDeps {
  store: PaymentStore;
  payments: PaymentRepository;
  events: PaymentEventRepository;
  jobs: JobRepository;
  idempotencyKeys: IdempotencyKeyRepository;
  gateway: Pick<PaymentGateway, 'tokenize'>;
  /** Announces committed events and enqueued jobs once their transaction is durable. */
  publisher: PaymentEventPublisher;
  logger: Logger;
  clock?: () => Date;
  idempotencyTtlMs?: number;
  /** Optimistic-lock retries before giving up with 409 CONCURRENT_MODIFICATION. */
  maxTransitionAttempts?: number;
  /** Gateway attempts allowed per payment, recorded on its job. */
  jobMaxAttempts?: number;
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

export interface FailedAttempt {
  attempt: number;
  code: PaymentFailureCode;
  message: string;
  retryAt: Date;
  /** When the failed gateway call started, and how long it ran before failing. */
  startedAt?: string;
  durationMs?: number;
}

/** Applies a change to a freshly read payment and describes the audit event for it. */
type Change = (payment: Payment) => Omit<NewPaymentEvent, 'paymentId'>;

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

    return this.deps.store.transaction(async (tx) => {
      const keys = this.deps.idempotencyKeys.withTransaction(tx);
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
        await keys.recordReplay(idempotencyKey, now);
        return {
          statusCode: claim.existing.responseStatus ?? 202,
          body: claim.existing.responseBody as ApiSuccess<PaymentView>,
          replayed: true,
        };
      }

      const card = this.deps.gateway.tokenize(dto.card);
      const payment = await this.deps.payments.withTransaction(tx).insert({
        amount: dto.amount,
        currency: dto.currency,
        customerEmail: dto.customerEmail,
        description: dto.description ?? null,
        paymentMethod: {
          token: card.token,
          brand: card.brand,
          last4: card.last4,
          expMonth: dto.card.expMonth,
          expYear: dto.card.expYear,
        },
      });
      const created = await this.deps.events.withTransaction(tx).append({
        paymentId: payment.id,
        type: PaymentEventType.CREATED,
        toStatus: payment.status,
        metadata: { amount: payment.amount, currency: payment.currency, ...this.trace() },
      });
      await this.deps.jobs
        .withTransaction(tx)
        .enqueuePaymentProcessing(payment.id, this.deps.jobMaxAttempts);
      this.deps.publisher.paymentEvent(tx, toStreamMessage(payment, created));
      this.deps.publisher.jobEnqueued(tx);

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

  /** Newest first, keyset-paginated. The cursor is opaque to clients. */
  async list(
    query: ListPaymentsQueryDto,
  ): Promise<{ items: Payment[]; nextCursor: string | null }> {
    const page = await this.deps.payments.listPage({
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      after: query.cursor ? decodeCursor(query.cursor) : undefined,
      status: query.status,
      currency: query.currency,
      from: query.from,
      to: query.to,
      search: query.q || undefined,
    });
    return { items: page.items, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  /** The creating request and its idempotency record, for the payment inspector. */
  async creationRequest(
    id: string,
  ): Promise<{ payment: Payment; key: IdempotencyKey | null }> {
    const payment = await this.get(id);
    return { payment, key: await this.deps.idempotencyKeys.findForPayment(id) };
  }

  async listEvents(paymentId: string): Promise<PaymentEvent[]> {
    await this.get(paymentId);
    return this.deps.events.listForPayment(paymentId);
  }

  /**
   * Events after `afterSequence` (optionally for one payment), each paired with the payment's
   * current state: what a reconnecting stream client missed.
   */
  async streamBacklog(
    afterSequence: number,
    limit: number,
    paymentId?: string,
  ): Promise<PaymentStreamMessage[]> {
    const events = await this.deps.events.listAfter(afterSequence, limit, paymentId);
    const ids = [...new Set(events.map((e) => e.paymentId))];
    const byId = new Map((await this.deps.payments.findByIds(ids)).map((p) => [p.id, p]));
    return events.flatMap((event) => {
      const payment = byId.get(event.paymentId);
      return payment ? [toStreamMessage(payment, event)] : [];
    });
  }

  async stats(): Promise<StatsView> {
    const { countsByStatus, succeededVolume, processingTimeMs } =
      await this.deps.payments.aggregates();
    const counts = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, 0])) as Record<
      PaymentStatus,
      number
    >;
    for (const { status, count } of countsByStatus) counts[status] = count;

    // A refunded payment was approved first, so it counts towards the success rate.
    const approved = counts.SUCCEEDED + counts.REFUNDED;
    const processed = approved + counts.FAILED;
    return {
      countsByStatus: counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      successRate: processed === 0 ? null : approved / processed,
      volumeByCurrency: Object.fromEntries(
        succeededVolume.map((v) => [v.currency, v.total]),
      ),
      processingTimeMs,
    };
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
   * The one way a payment's status changes, for clients and the worker alike. Validated
   * against the shared state machine on a fresh read, persisted optimistically (see update).
   */
  transition(
    id: string,
    to: PaymentStatus,
    actor: TransitionActor,
    options: TransitionOptions = {},
  ): Promise<Payment> {
    return this.update(id, options.expectedVersion, (payment) => {
      const change = payment.transitionTo(to, actor, this.clock());
      if (change.isFailure) throw new InvalidStateTransitionError(change.errorValue());
      options.mutate?.(payment);
      return {
        type: PaymentEventType.STATUS_CHANGED,
        fromStatus: change.getValue().from,
        toStatus: to,
        reason: options.reason ?? null,
        metadata: { actor, ...options.metadata },
      };
    });
  }

  /** A gateway attempt failed in a retryable way: count it and log it, status unchanged. */
  recordFailedAttempt(id: string, failure: FailedAttempt): Promise<Payment> {
    return this.update(id, undefined, (payment) => {
      if (payment.status !== PaymentStatus.PROCESSING) {
        throw new ConflictError(
          `Cannot record an attempt on a ${payment.status} payment`,
          ErrorCode.INVALID_STATE_TRANSITION,
        );
      }
      payment.attempts = failure.attempt;
      return {
        type: PaymentEventType.ATTEMPT_FAILED,
        reason: failure.message,
        metadata: {
          attempt: failure.attempt,
          code: failure.code,
          retryAt: failure.retryAt.toISOString(),
          ...(failure.startedAt === undefined
            ? {}
            : { startedAt: failure.startedAt, durationMs: failure.durationMs }),
        },
      };
    });
  }

  /**
   * Read → apply the change → write only if the version is unchanged, with its audit event
   * in the same transaction. Nothing is locked while deciding (the gateway call can sit
   * between a read and the write). If another writer wins the
   * race, re-read and re-apply: a cancel that loses to the worker moving the payment to
   * PROCESSING is then rejected as an invalid transition instead of overwriting it. With
   * If-Match the caller asked for "this exact version", so a moved payment is a 412.
   */
  private async update(
    id: string,
    expectedVersion: number | undefined,
    change: Change,
  ): Promise<Payment> {
    for (let attempt = 1; ; attempt++) {
      const payment = await this.get(id);
      const readVersion = payment.version;
      if (expectedVersion !== undefined && expectedVersion !== readVersion) {
        throw new StalePaymentVersionError(expectedVersion, readVersion);
      }

      const event = change(payment);
      const saved = await this.deps.store.transaction(async (tx) => {
        const updated = await this.deps.payments
          .withTransaction(tx)
          .updateIfVersion(payment, readVersion);
        if (!updated) return null;
        const appended = await this.deps.events.withTransaction(tx).append({
          ...event,
          paymentId: id,
          metadata: { ...this.trace(), ...event.metadata },
        });
        this.deps.publisher.paymentEvent(tx, toStreamMessage(updated, appended));
        return updated;
      });

      if (saved) {
        this.deps.logger.info(
          {
            paymentId: id,
            event: event.type,
            from: event.fromStatus,
            to: event.toStatus,
            version: saved.version,
          },
          'payment updated',
        );
        return saved;
      }

      if (expectedVersion !== undefined) {
        throw new StalePaymentVersionError(expectedVersion, (await this.get(id)).version);
      }
      if (attempt >= this.maxTransitionAttempts)
        throw new ConcurrentModificationError(id);
      this.deps.logger.debug(
        { paymentId: id, attempt },
        'lost optimistic lock race, retrying',
      );
    }
  }

  /** Correlation ids of the current request or job, recorded on every audit event. */
  private trace(): Record<string, string | number> {
    return { ...requestContext.get() };
  }
}
