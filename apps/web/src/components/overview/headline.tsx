'use client';

import type { Currency, InsightsRange, InsightsView } from '@payment-sim/shared';
import { Activity, Clock3, Coins, Repeat } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  formatCount,
  formatMoneyCompact,
  formatMs,
  formatPercentWhole,
} from '@/lib/format';
import { Skeleton } from '../ui/skeleton';
import { NumberTicker } from '../ui/number-ticker';

export const RANGE_COPY: Record<InsightsRange, string> = {
  '15m': 'the last 15 minutes',
  '1h': 'the last hour',
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
};

/** The one hero figure on the overview, on the brand surface. */
export function ApprovalHero({
  insights,
  range,
}: {
  insights?: InsightsView;
  range: InsightsRange;
}) {
  const t = insights?.totals;
  const settled = t ? t.succeeded + t.failed : 0;
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative flex min-h-[236px] flex-col overflow-hidden rounded-panel bg-brand p-6 text-on-brand shadow-brand"
    >
      {/* Quiet texture: concentric rings echoing the pipeline's nodes. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-16 -bottom-24 size-72 opacity-[0.14]"
        viewBox="0 0 200 200"
      >
        {[30, 55, 80, 100].map((r) => (
          <circle
            key={r}
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="white"
            strokeWidth="1.5"
          />
        ))}
      </svg>
      <h2 id="hero-heading" className="text-[15px] font-semibold">
        Approval rate
      </h2>
      <p className="hero-number mt-auto pt-6">
        {t?.approvalRate == null ? (
          '—'
        ) : (
          <NumberTicker
            value={t.approvalRate * 100}
            format={(n) => `${Math.round(n)}%`}
          />
        )}
      </p>
      <p className="mt-3 max-w-[30ch] text-[13px] leading-snug text-on-brand-2">
        {!insights
          ? 'Loading…'
          : settled === 0
            ? `Nothing settled in ${RANGE_COPY[range]} yet.`
            : `${formatCount(t!.succeeded)} of ${formatCount(settled)} payments that settled in ${RANGE_COPY[range]} were approved.`}
      </p>
    </section>
  );
}

function Tile({
  title,
  icon: Icon,
  value,
  caption,
}: {
  title: string;
  icon: LucideIcon;
  value: ReactNode;
  caption: ReactNode;
}) {
  return (
    <section className="panel flex min-w-0 flex-col p-5">
      <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
        <Icon className="size-4 text-ink-3" aria-hidden />
        {title}
      </h3>
      <div className="mt-auto pt-5 text-[28px] leading-none font-semibold tracking-[-0.025em] text-ink tabular-nums">
        {value}
      </div>
      <p className="mt-2 text-xs text-ink-2">{caption}</p>
    </section>
  );
}

/** Volume, throughput, latency and retry rescue for the window: four tiles, one number each. */
export function HeadlineTiles({ insights }: { insights?: InsightsView }) {
  if (!insights) {
    return (
      <>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[150px] rounded-panel" />
        ))}
      </>
    );
  }
  const t = insights.totals;
  const volume = (
    Object.entries(t.approvedVolumeByCurrency) as Array<[Currency, number]>
  ).sort((a, b) => b[1] - a[1]);
  const [lead, ...rest] = volume;
  const retried =
    insights.failures.recoveredByRetry + insights.failures.failedAfterRetries;

  return (
    <>
      <Tile
        title="Approved volume"
        icon={Coins}
        value={lead ? formatMoneyCompact(lead[1], lead[0]) : '—'}
        caption={
          rest.length
            ? rest.map(([c, v]) => formatMoneyCompact(v, c)).join(' · ')
            : lead
              ? 'One currency in this window'
              : 'No approvals in this window'
        }
      />
      <Tile
        title="Payments per minute"
        icon={Activity}
        value={
          <NumberTicker
            value={t.ratePerMinute}
            format={(n) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1))}
          />
        }
        caption={
          <>
            Last 5 minutes ·{' '}
            <span className="font-medium text-ink">{formatCount(t.inFlight)}</span> in
            flight now
          </>
        }
      />
      <Tile
        title="Time to final state"
        icon={Clock3}
        value={formatMs(insights.latencyMs.p50)}
        caption={<>Median · p95 {formatMs(insights.latencyMs.p95)}, retries included</>}
      />
      <Tile
        title="Rescued by retry"
        icon={Repeat}
        value={<NumberTicker value={insights.failures.recoveredByRetry} />}
        caption={
          retried
            ? `${formatPercentWhole(insights.failures.recoveredByRetry / retried)} of ${formatCount(retried)} retried payments`
            : 'No payment needed a retry'
        }
      />
    </>
  );
}
