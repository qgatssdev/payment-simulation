import type { PaymentFailureCode } from '@payment-sim/shared';
import { PaymentStatus } from '@payment-sim/shared';
import { cn } from '@/lib/utils';
import { REASON, STATUS } from '@/utils/vocabulary';

export { STATUS_LABEL } from '@/utils/vocabulary';

/**
 * Status as icon + word: the icon wears the status colour on a faint wash of it; the word
 * stays in ink. The same component everywhere a status appears.
 */
export function StatusBadge({
  status,
  className,
  size = 'md',
}: {
  status: PaymentStatus;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const { icon: Icon, label, color } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap text-ink',
        size === 'lg' ? 'h-8 pr-3.5 pl-2.5 text-sm' : 'h-6 pr-2.5 pl-1.5 text-xs',
        className,
      )}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 13%, transparent)` }}
    >
      <Icon
        aria-hidden
        className={cn(
          size === 'lg' ? 'size-4' : 'size-3.5',
          status === PaymentStatus.PROCESSING && 'animate-spin [animation-duration:1.6s]',
        )}
        style={{ color }}
      />
      {label}
    </span>
  );
}

/** A failure reason as icon + word, in the reason's hue. */
export function ReasonBadge({
  code,
  className,
}: {
  code: PaymentFailureCode;
  className?: string;
}) {
  const { icon: Icon, label, color } = REASON[code];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-xs font-medium whitespace-nowrap text-ink',
        className,
      )}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      <Icon aria-hidden className="size-3.5" style={{ color }} />
      {label}
    </span>
  );
}

/** The bare mark: an icon in its colour on a tinted round tile (legends, lists, pipeline). */
export function TermDot({
  color,
  icon: Icon,
  className,
}: {
  color: string;
  icon: (typeof STATUS)['PENDING']['icon'];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full',
        className,
      )}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      <Icon className="size-3.5" style={{ color }} />
    </span>
  );
}
