/** Stable, machine-readable error codes. HTTP status is a transport detail; clients branch on these. */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_REQUEST_IN_PROGRESS = 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Failure reasons recorded on a FAILED payment, as reported by the (simulated) gateway. */
export enum PaymentFailureCode {
  CARD_DECLINED = 'card_declined',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  EXPIRED_CARD = 'expired_card',
  PROCESSING_ERROR = 'processing_error',
  GATEWAY_TIMEOUT = 'gateway_timeout',
}

export const HEADERS = {
  IDEMPOTENCY_KEY: 'Idempotency-Key',
  IDEMPOTENT_REPLAYED: 'Idempotent-Replayed',
  REQUEST_ID: 'X-Request-Id',
  IF_MATCH: 'If-Match',
  ETAG: 'ETag',
} as const;
