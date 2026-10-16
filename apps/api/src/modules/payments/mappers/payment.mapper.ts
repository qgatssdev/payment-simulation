import type {
  PaymentEventView,
  PaymentRequestView,
  PaymentStreamMessage,
  PaymentView,
} from '@payment-sim/shared';
import type { IdempotencyKey } from '../entity/idempotency-key.entity';
import type { PaymentEvent } from '../entity/payment-event.entity';
import type { Payment } from '../entity/payment.entity';

/** Entity → wire format. Explicit field-by-field, so a new column is never exposed by accident. */
export function toPaymentView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    paymentMethod: {
      brand: payment.paymentMethod.brand,
      last4: payment.paymentMethod.last4,
      expMonth: payment.paymentMethod.expMonth,
      expYear: payment.paymentMethod.expYear,
    },
    customerEmail: payment.customerEmail,
    description: payment.description,
    failureCode: payment.failureCode,
    failureMessage: payment.failureMessage,
    attempts: payment.attempts,
    version: payment.version,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    processedAt: payment.processedAt?.toISOString() ?? null,
  };
}

export function toPaymentEventView(event: PaymentEvent): PaymentEventView {
  return {
    id: event.id,
    sequence: event.sequence,
    paymentId: event.paymentId,
    type: event.type,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reason: event.reason,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  };
}

/**
 * The request that created a payment. The card number and CVC were never stored, so the body
 * is rebuilt from the payment with both masked: the same fields, never the secrets.
 */
export function toPaymentRequestView(
  payment: Payment,
  key: IdempotencyKey | null,
): PaymentRequestView {
  const body: Record<string, unknown> = {
    amount: payment.amount,
    currency: payment.currency,
    customerEmail: payment.customerEmail,
    ...(payment.description === null ? {} : { description: payment.description }),
    card: {
      number: `•••• •••• •••• ${payment.paymentMethod.last4}`,
      expMonth: payment.paymentMethod.expMonth,
      expYear: payment.paymentMethod.expYear,
      cvc: '•••',
    },
  };
  return {
    idempotencyKey: key?.key ?? null,
    replayCount: key?.replayCount ?? 0,
    lastReplayedAt: key?.lastReplayedAt?.toISOString() ?? null,
    keyExpiresAt: key?.expiresAt.toISOString() ?? null,
    request: { method: 'POST', path: '/api/v1/payments', body },
    response:
      key?.responseStatus && key.responseBody
        ? { status: key.responseStatus, body: key.responseBody }
        : null,
  };
}

/** What a stream subscriber receives: the event plus the payment's state after it. */
export function toStreamMessage(
  payment: Payment,
  event: PaymentEvent,
): PaymentStreamMessage {
  return {
    type: event.type,
    payment: toPaymentView(payment),
    event: toPaymentEventView(event),
  };
}
