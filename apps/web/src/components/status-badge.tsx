import type { PaymentStatus } from '@payment-sim/shared';
import { Ban, CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/cn';

/**
 * Status always travels as icon + label; colour only reinforces it. Reserved status colours
 * are used for the two outcomes that mean good/critical; in-between states stay neutral.
 */
const STYLES: Record<
  PaymentStatus,
  { icon: ComponentType<{ className?: string }>; tone: string; spin?: boolean }
> = {
  PENDING: { icon: Clock, tone: 'text-ink-2 border-line' },
  PROCESSING: { icon: Loader2, tone: 'text-accent-ink border-accent/40', spin: true },
  SUCCEEDED: { icon: CheckCircle2, tone: 'text-good-ink border-good/40' },
  FAILED: { icon: XCircle, tone: 'text-critical-ink border-critical/40' },
  CANCELLED: { icon: Ban, tone: 'text-ink-3 border-line' },
  REFUNDED: { icon: RotateCcw, tone: 'text-ink-2 border-line' },
};

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export function StatusBadge({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  const { icon: Icon, tone, spin } = STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
