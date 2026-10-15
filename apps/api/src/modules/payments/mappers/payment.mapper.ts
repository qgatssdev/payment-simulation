import type { PaymentEventView, PaymentView } from '@payment-sim/shared';
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
    paymentId: event.paymentId,
    type: event.type,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reason: event.reason,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  };
}
