import type { PaymentEventView, PaymentStatus } from '@payment-sim/shared';
import { TermDot } from '@/common/statusBadge';
import { formatMs } from '@/utils/format';
import { STATUS } from '@/utils/vocabulary';

/** The states this payment passed through, top to bottom, with when it reached each. */
export function LifecyclePath({
  createdAt,
  events,
}: {
  createdAt: string;
  events: PaymentEventView[];
}) {
  const start = new Date(createdAt).getTime();
  const steps: Array<{ status: PaymentStatus; at: number }> = [];
  for (const e of events) {
    if (e.toStatus && steps.at(-1)?.status !== e.toStatus) {
      steps.push({ status: e.toStatus, at: new Date(e.createdAt).getTime() });
    }
  }
  return (
    <ol aria-label="Lifecycle path">
      {steps.map((s, i) => {
        const term = STATUS[s.status];
        return (
          <li
            key={`${s.status}-${i}`}
            className="relative flex items-center gap-3 pb-4 last:pb-0"
          >
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute top-7 bottom-0 left-[13.5px] w-px bg-[var(--grid)]"
              />
            )}
            <TermDot color={term.color} icon={term.icon} />
            <span className="flex flex-1 items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium text-ink">{term.label}</span>
              <span className="text-xs text-ink-3 tabular-nums">
                {i === 0 ? 'accepted' : `+${formatMs(s.at - start)}`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
