import type { CardBrand } from './card';
import type { Currency } from './currency';
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
  /** Succeeded ÷ (succeeded + failed), or null when nothing has settled yet. */
  successRate: number | null;
  volumeByCurrency: Partial<Record<Currency, number>>;
  processingTimeMs: { p50: number | null; p95: number | null };
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

export interface ValidationIssue {
  /** Dot path into the request, e.g. `card.expYear`. */
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
