import type { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { BaseRecord } from '../../../libs/core/base/base.entity';

/**
 * Append-only audit log: one record per lifecycle fact (created, status changed, attempt
 * failed). Written in the same transaction as the change it records, so the log can never
 * disagree with the payment.
 */
export interface PaymentEvent extends BaseRecord {
  /**
   * Store-assigned and strictly increasing across all events. Timestamps can tie; this cannot,
   * so it orders the timeline and is the SSE event id clients resume from (Last-Event-ID).
   */
  sequence: number;
  paymentId: string;
  type: PaymentEventType;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus | null;
  reason: string | null;
  metadata: Record<string, unknown>;
}
