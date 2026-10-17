import type { PaymentEventView, PaymentFailureCode } from '@payment-sim/shared';
import { PaymentEventType } from '@payment-sim/shared';
import { CirclePlus } from 'lucide-react';
import { TermDot } from '@/common/statusBadge';
import { formatDateTime } from '@/utils/format';
import { REASON, STATUS, STATUS_LABEL } from '@/utils/vocabulary';

function describe(event: PaymentEventView): { title: string; detail?: string } {
  const meta = event.metadata;
  switch (event.type) {
    case PaymentEventType.CREATED:
      return { title: 'Payment accepted', detail: 'Queued for processing' };
    case PaymentEventType.ATTEMPT_FAILED:
      return {
        title: `Gateway attempt ${String(meta.attempt)} failed`,
        detail: `${event.reason ?? String(meta.code)} · retry scheduled for ${
          typeof meta.retryAt === 'string' ? formatDateTime(meta.retryAt) : 'later'
        }`,
      };
    default: {
      const by = meta.actor === 'client' ? 'by request' : 'by the worker';
      const auth =
        typeof meta.authorizationCode === 'string'
          ? ` · auth ${meta.authorizationCode}`
          : '';
      return {
        title: `${event.fromStatus ? STATUS_LABEL[event.fromStatus] : '—'} → ${
          event.toStatus ? STATUS_LABEL[event.toStatus] : '—'
        }`,
        detail: [event.reason, `${by}${auth}`].filter(Boolean).join(' · '),
      };
    }
  }
}

function markOf(event: PaymentEventView) {
  if (event.type === PaymentEventType.ATTEMPT_FAILED) {
    return REASON[event.metadata.code as PaymentFailureCode] ?? REASON.processing_error;
  }
  if (event.type === PaymentEventType.CREATED) {
    return { icon: CirclePlus, color: STATUS.PENDING.color };
  }
  return event.toStatus ? STATUS[event.toStatus] : STATUS.PENDING;
}

/** The audit log, oldest first, joined by a rail; new entries are announced politely. */
export function EventTimeline({ events }: { events: PaymentEventView[] }) {
  return (
    <ol aria-live="polite" aria-label="Payment timeline" className="relative">
      {events.map((event, i) => {
        const { title, detail } = describe(event);
        const mark = markOf(event);
        return (
          <li
            key={event.sequence}
            className="relative flex animate-pop-in gap-3 pb-5 last:pb-0"
          >
            {i < events.length - 1 && (
              <span
                aria-hidden
                className="absolute top-8 bottom-1 left-[13.5px] w-px bg-[var(--grid)]"
              />
            )}
            <TermDot color={mark.color} icon={mark.icon} />
            <div className="min-w-0 pt-0.5">
              <p className="text-[13px] font-semibold text-ink">{title}</p>
              {detail && <p className="mt-0.5 text-xs text-ink-2">{detail}</p>}
              <p className="mt-1 font-mono text-[11px] text-ink-3">
                #{event.sequence} · {formatDateTime(event.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
