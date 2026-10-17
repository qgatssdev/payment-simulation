import type { PaymentStatus, TestCard } from '@payment-sim/shared';
import { PaymentFailureCode } from '@payment-sim/shared';
import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  CalendarX,
  CircleCheck,
  CircleX,
  Clock3,
  LoaderCircle,
  ServerCrash,
  ShieldX,
  Shuffle,
  TimerOff,
  Undo2,
  WalletMinimal,
} from 'lucide-react';

/**
 * The product's core vocabulary. Each payment status and each failure reason has exactly one
 * word, one icon and one colour, used identically in the pipeline, tables, timelines, charts
 * and badges. Colours are CSS variables (validated per mode, see globals.css); they paint marks
 * and icons only. Text always stays in ink.
 */
export interface Term {
  label: string;
  icon: LucideIcon;
  /** CSS colour value, e.g. var(--status-failed). */
  color: string;
}

export const STATUS: Record<PaymentStatus, Term & { description: string }> = {
  PENDING: {
    label: 'Pending',
    icon: Clock3,
    color: 'var(--status-pending)',
    description: 'Accepted and queued for the worker.',
  },
  PROCESSING: {
    label: 'Processing',
    icon: LoaderCircle,
    color: 'var(--status-processing)',
    description: 'The worker is charging the gateway, retrying transient failures.',
  },
  SUCCEEDED: {
    label: 'Succeeded',
    icon: CircleCheck,
    color: 'var(--status-succeeded)',
    description: 'Approved by the gateway; the money was captured.',
  },
  FAILED: {
    label: 'Failed',
    icon: CircleX,
    color: 'var(--status-failed)',
    description: 'Declined, or retries ran out.',
  },
  CANCELLED: {
    label: 'Cancelled',
    icon: Ban,
    color: 'var(--status-cancelled)',
    description: 'Cancelled by the client before processing started.',
  },
  REFUNDED: {
    label: 'Refunded',
    icon: Undo2,
    color: 'var(--status-refunded)',
    description: 'Captured, then returned to the customer.',
  },
};

/** Legacy name kept for components and tests that import it. */
export const STATUS_LABEL = Object.fromEntries(
  Object.entries(STATUS).map(([status, term]) => [status, term.label]),
) as Record<PaymentStatus, string>;

/** Fixed order: the validated adjacency of the reason hues. Never sort these by count. */
export const REASON_ORDER = [
  PaymentFailureCode.CARD_DECLINED,
  PaymentFailureCode.INSUFFICIENT_FUNDS,
  PaymentFailureCode.PROCESSING_ERROR,
  PaymentFailureCode.GATEWAY_TIMEOUT,
] as const;

export const REASON: Record<PaymentFailureCode, Term & { retryable: boolean }> = {
  [PaymentFailureCode.CARD_DECLINED]: {
    label: 'Declined',
    icon: ShieldX,
    color: 'var(--reason-declined)',
    retryable: false,
  },
  [PaymentFailureCode.INSUFFICIENT_FUNDS]: {
    label: 'Insufficient funds',
    icon: WalletMinimal,
    color: 'var(--reason-insufficient)',
    retryable: false,
  },
  [PaymentFailureCode.PROCESSING_ERROR]: {
    label: 'Processing error',
    icon: ServerCrash,
    color: 'var(--reason-processing)',
    retryable: true,
  },
  [PaymentFailureCode.GATEWAY_TIMEOUT]: {
    label: 'Gateway timeout',
    icon: TimerOff,
    color: 'var(--reason-timeout)',
    retryable: true,
  },
  [PaymentFailureCode.EXPIRED_CARD]: {
    label: 'Expired card',
    icon: CalendarX,
    color: 'var(--reason-other)',
    retryable: false,
  },
};

/**
 * A test card's scenario wears the term for the outcome it produces: the success cards wear
 * Succeeded, the flaky card wears Processing error (what its retries show), and so on.
 */
export function scenarioTerm(card: Pick<TestCard, 'outcome'> | undefined): Term {
  switch (card?.outcome.kind) {
    case 'succeed':
      return STATUS.SUCCEEDED;
    case 'decline':
      return REASON[card.outcome.code];
    case 'transient':
      return REASON[PaymentFailureCode.PROCESSING_ERROR];
    case 'timeout':
      return REASON[PaymentFailureCode.GATEWAY_TIMEOUT];
    default:
      return { label: 'Random', icon: Shuffle, color: 'var(--reason-other)' };
  }
}
