import type { PaymentEventView } from '@payment-sim/shared';
import { PaymentEventType } from '@payment-sim/shared';
import { AlertTriangle, ArrowRight, PlusCircle } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { STATUS_LABEL } from './status-badge';

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

const ICONS = {
  [PaymentEventType.CREATED]: PlusCircle,
  [PaymentEventType.STATUS_CHANGED]: ArrowRight,
  [PaymentEventType.ATTEMPT_FAILED]: AlertTriangle,
};

/** The audit log, oldest first; new entries are announced politely to screen readers. */
export function EventTimeline({ events }: { events: PaymentEventView[] }) {
  return (
    <ol aria-live="polite" aria-label="Payment timeline" className="space-y-3">
      {events.map((event) => {
        const { title, detail } = describe(event);
        const Icon = ICONS[event.type];
        return (
          <li key={event.sequence} className="flex gap-3">
            <Icon
              aria-hidden
              className={
                event.type === PaymentEventType.ATTEMPT_FAILED
                  ? 'mt-0.5 size-4 shrink-0 text-warning'
                  : 'mt-0.5 size-4 shrink-0 text-ink-3'
              }
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{title}</p>
              {detail && <p className="text-xs text-ink-2">{detail}</p>}
              <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                #{event.sequence} · {formatDateTime(event.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
