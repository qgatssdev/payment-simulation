import type { StatsView } from '@payment-sim/shared';
import { formatDuration, formatPercent, formatVolume } from '@/lib/format';
import { Skeleton } from './ui/skeleton';

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="text-xs font-medium text-ink-2">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

/** Headline numbers: a stat tile, not a chart, is the right form for a single value. */
export function StatsCards({ stats }: { stats: StatsView | undefined }) {
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
    );
  }
  const volume = formatVolume(stats.volumeByCurrency);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Payments">{stats.total.toLocaleString()}</Tile>
      <Tile label="Success rate">
        {formatPercent(stats.successRate)}
        <span className="ml-2 text-xs font-normal text-ink-3">of processed</span>
      </Tile>
      <Tile label="Captured volume">
        {volume.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-col text-base leading-6">
            {volume.map((v) => (
              <span key={v}>{v}</span>
            ))}
          </span>
        )}
      </Tile>
      <Tile label="Processing time">
        <span className="text-base">
          p50 {formatDuration(stats.processingTimeMs.p50)}
          <span className="mx-1.5 text-ink-3">·</span>p95{' '}
          {formatDuration(stats.processingTimeMs.p95)}
        </span>
      </Tile>
    </dl>
  );
}
