import type { CardBrand } from './card';
import type { Currency } from './currency';
import type { InsightsRange } from './dto/insights-query.dto';
import type { ErrorCode, PaymentFailureCode } from './error-codes';
import type { PaymentEventType, PaymentStatus } from './payment-status';

/** Response shapes. Dates are ISO-8601 strings because that is what crosses the wire. */

export interface PaymentMethodView {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface PaymentView {
  id: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  paymentMethod: PaymentMethodView;
  customerEmail: string;
  description: string | null;
  failureCode: PaymentFailureCode | null;
  failureMessage: string | null;
  attempts: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface PaymentEventView {
  id: string;
  /** Strictly increasing across all events; also the SSE event id clients resume from. */
  sequence: number;
  paymentId: string;
  type: PaymentEventType;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StatsView {
  countsByStatus: Record<PaymentStatus, number>;
  total: number;
  /** Approved ÷ (approved + failed) among processed payments; null until one settles. */
  successRate: number | null;
  /** Captured volume in minor units: payments currently SUCCEEDED (refunds excluded). */
  volumeByCurrency: Partial<Record<Currency, number>>;
  processingTimeMs: { p50: number | null; p95: number | null };
}

/** One time bucket of activity, counted from audit events (when things happened). */
export interface ActivityBucketView {
  start: string;
  /** Payments accepted. */
  created: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  refunded: number;
  /** Gateway attempts that failed and were retried. */
  retries: number;
}

export interface CodeCountView {
  code: PaymentFailureCode;
  count: number;
}

/** Activity, outcomes and failure analysis for a time window ending now. */
export interface InsightsView {
  range: InsightsRange;
  from: string;
  to: string;
  bucketMs: number;
  buckets: ActivityBucketView[];
  totals: {
    created: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    refunded: number;
    retries: number;
    /** Succeeded ÷ (succeeded + failed) among payments settled in the window. */
    approvalRate: number | null;
    /** Minor units approved in the window, per currency (refunds not deducted). */
    approvedVolumeByCurrency: Partial<Record<Currency, number>>;
    /** Payments accepted per minute over the last five minutes. */
    ratePerMinute: number;
    /** PENDING or PROCESSING right now, whatever the window. */
    inFlight: number;
  };
  /** Creation to final state, for payments settled in the window. */
  latencyMs: { p50: number | null; p95: number | null };
  failures: {
    /** Final failure reasons of payments that failed in the window. */
    byCode: CodeCountView[];
    /** Reasons of retried attempts in the window. */
    retriesByCode: CodeCountView[];
    /** Settled payments by gateway attempts used, split by outcome. */
    attempts: Array<{ attempts: number; succeeded: number; failed: number }>;
    firstAttemptSuccess: number;
    /** Approved only after at least one failed attempt. */
    recoveredByRetry: number;
    /** Failed after more than one attempt. */
    failedAfterRetries: number;
  };
}

/** The request that created a payment, as stored with its idempotency key. */
export interface PaymentRequestView {
  /** Null once the key has expired (24 h) and been purged. */
  idempotencyKey: string | null;
  replayCount: number;
  lastReplayedAt: string | null;
  keyExpiresAt: string | null;
  request: {
    method: 'POST';
    path: string;
    /** The body as received, with the card number and CVC masked. */
    body: Record<string, unknown>;
  };
  /** The stored response every replay receives; null once the key is gone. */
  response: { status: number; body: unknown } | null;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

export interface CursorPagination {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApiPage<T> {
  success: true;
  message: string;
  data: T[];
  pagination: CursorPagination;
}

export type RequestLocation = 'body' | 'query' | 'params' | 'headers';

export interface ValidationIssue {
  location: RequestLocation;
  /** Dot path within that location, e.g. `card.expYear`. */
  field: string;
  messages: string[];
}

export interface ApiErrorBody {
  success: false;
  message: string;
  error: {
    code: ErrorCode;
    details?: ValidationIssue[] | Record<string, unknown>;
  };
  requestId: string;
}

/** Payload of each Server-Sent Event emitted on the payment streams. */
export interface PaymentStreamMessage {
  type: PaymentEventType;
  payment: PaymentView;
  event: PaymentEventView;
}
