export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export const PAYMENT_STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus);

export enum PaymentEventType {
  CREATED = 'payment.created',
  STATUS_CHANGED = 'payment.status_changed',
  ATTEMPT_FAILED = 'payment.attempt_failed',
}
