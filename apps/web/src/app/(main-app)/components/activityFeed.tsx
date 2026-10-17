'use client';

import type {
  PaymentFailureCode,
  PaymentStreamMessage,
  PaymentView,
} from '@payment-sim/shared';
import { PaymentEventType } from '@payment-sim/shared';
import { Radio } from 'lucide-react';
import Link from 'next/link';
import { TermDot } from '@/common/statusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { useNow } from '@/hooks/useNow';
import { useLiveFeed } from '@/providers/live.provider';
import { usePayments } from '@/services/payments/queries';
import { formatMoney, formatRelative } from '@/utils/format';
import type { Term } from '@/utils/vocabulary';
import { REASON, STATUS } from '@/utils/vocabulary';

interface Row {
  key: string;
  payment: PaymentView;
  what: string;
  term: Term;
  at: string;
  live: boolean;
}

function describe(m: PaymentStreamMessage): Pick<Row, 'what' | 'term'> {
  const { event } = m;
  if (event.type === PaymentEventType.CREATED)
    return { what: 'Accepted', term: STATUS.PENDING };
  if (event.type === PaymentEventType.ATTEMPT_FAILED) {
    const reason =
      REASON[event.metadata.code as PaymentFailureCode] ?? REASON.processing_error;
    return {
      what: `Attempt ${String(event.metadata.attempt)} failed, retrying`,
      term: reason,
    };
  }
  const to = event.toStatus ?? m.payment.status;
  return { what: STATUS[to].label, term: STATUS[to] };
}

/**
 * Everything happening now, newest first. Starts from the latest payments, then every live
 * event slides in at the top with a brief highlight.
 */
export function ActivityFeed() {
  const feed = useLiveFeed();
  const latest = usePayments({ limit: 8 });
  const now = useNow(5_000);

  // One row per payment: its latest event (the feed is newest first).
  const latestByPayment = feed.filter(
    (m, i) => feed.findIndex((other) => other.payment.id === m.payment.id) === i,
  );
  const liveRows: Row[] = latestByPayment.map((m) => ({
    key: `e${m.event.sequence}`,
    payment: m.payment,
    at: m.event.createdAt,
    live: true,
    ...describe(m),
  }));
  const seen = new Set(liveRows.map((r) => r.payment.id));
  const initialRows: Row[] = (latest.data?.pages[0]?.data ?? [])
    .filter((p) => !seen.has(p.id))
    .map((p) => ({
      key: `p${p.id}`,
      payment: p,
      at: p.updatedAt,
      live: false,
      what: STATUS[p.status].label,
      term: STATUS[p.status],
    }));
  const rows = [...liveRows, ...initialRows].slice(0, 7);

  if (latest.isPending && rows.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState icon={Radio} title="Waiting for activity">
        Create a payment or run the simulator; every event appears here the moment it
        happens.
      </EmptyState>
    );
  }

  return (
    <ol aria-label="Recent activity" className="-mx-2 space-y-0.5">
      {rows.map((r) => (
        <li key={r.key} className={r.live ? 'animate-arrive rounded-xl' : undefined}>
          <Link
            href={`/payments/${r.payment.id}`}
            prefetch={false}
            className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-panel-2"
          >
            <TermDot color={r.term.color} icon={r.term.icon} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">
                {r.payment.description ?? `${r.payment.id.slice(0, 8)}…`}
              </span>
              <span className="block truncate text-xs text-ink-2">
                {r.what} · {formatRelative(r.at, now)}
              </span>
            </span>
            <span className="shrink-0 text-[13px] font-medium text-ink tabular-nums">
              {formatMoney(r.payment.amount, r.payment.currency)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
