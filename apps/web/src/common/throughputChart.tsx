'use client';

import type { ActivityBucketView, InsightsRange } from '@payment-sim/shared';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatClock, formatCount } from '@/utils/format';
import { STATUS } from '@/utils/vocabulary';

/** Round up to 1, 2 or 5 × 10^n so gridlines land on readable numbers. */
export function niceCeil(n: number): number {
  if (n <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 5, 10].find((m) => m * power >= n) ?? 10;
  return step * power;
}

const DEFAULT_HEIGHT = 240;

/**
 * The top of one side's scale. When a single bucket towers over the rest (more than three
 * times the next), the scale fits the rest and that bar is drawn broken, labelled with its
 * real value: one burst must not flatten every other bar into the baseline.
 */
export function sideScale(values: number[]): { max: number; clipped: boolean } {
  const [top = 0, next = 0] = [...values].sort((a, b) => b - a);
  if (next > 0 && top > 3 * next) return { max: niceCeil(next * 1.2), clipped: true };
  return { max: top === 0 ? 0 : niceCeil(top), clipped: false };
}

const SERIES = [
  {
    key: 'succeeded',
    label: 'Succeeded',
    color: STATUS.SUCCEEDED.color,
    icon: STATUS.SUCCEEDED.icon,
  },
  {
    key: 'failed',
    label: 'Failed',
    color: STATUS.FAILED.color,
    icon: STATUS.FAILED.icon,
  },
  {
    key: 'cancelled',
    label: 'Cancelled',
    color: STATUS.CANCELLED.color,
    icon: STATUS.CANCELLED.icon,
  },
] as const;

/**
 * Outcomes over time on one axis: approvals rise above the baseline, failures and
 * cancellations hang below it, at the same scale (so green and red never touch, and their
 * sizes compare honestly). The neutral line is payments accepted. Fixed columns, height
 * transitions: live updates grow bars in place instead of reflowing the chart.
 */
export function ThroughputChart({
  buckets,
  bucketMs,
  range,
  tickLabel,
  height = DEFAULT_HEIGHT,
}: {
  buckets: ActivityBucketView[];
  bucketMs: number;
  range?: InsightsRange;
  /** Axis and tooltip label for a bucket; defaults to its clock time. */
  tickLabel?: (start: string, index: number) => string;
  height?: number;
}) {
  const HEIGHT = height;
  const [active, setActive] = useState<number | null>(null);
  const upScale = sideScale(buckets.map((b) => Math.max(b.succeeded, b.created)));
  const downScale = sideScale(buckets.map((b) => b.failed + b.cancelled));
  const up = Math.max(upScale.max, 1);
  const down = downScale.max;
  // One scale for both directions; the baseline sits where it must for that scale.
  const span = up + down;
  const baseline = (up / span) * HEIGHT;
  const px = (n: number) => (n / span) * HEIGHT;
  const pxUp = (n: number) => px(Math.min(n, up));
  const pxDown = (n: number) => px(Math.min(n, down));
  const withDay = range === '7d';
  const label = (start: string, i: number) =>
    tickLabel?.(start, i) ?? formatClock(start, withDay);
  const n = buckets.length;
  const hovered = active === null ? undefined : buckets[active];

  const linePoints = buckets
    .map((b, i) => `${((i + 0.5) / n) * 100},${baseline - pxUp(b.created)}`)
    .join(' ');
  // Above the baseline: the top and, when it is a whole number, the middle; below: the bottom.
  const ticks = [up, Number.isInteger(up / 2) ? up / 2 : up, 0, ...(down ? [down] : [])];
  const labelEvery = Math.ceil(n / 6);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
        {SERIES.map(({ key, label, color }) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: color }}
            />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="16" height="8">
            <line
              x1="0"
              x2="16"
              y1="4"
              y2="4"
              stroke="var(--ink-2)"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
          </svg>
          Accepted
        </span>
      </div>

      <div className="flex gap-2" aria-hidden>
        <div
          className="relative w-8 shrink-0 text-right text-[11px] text-ink-3 tabular-nums"
          style={{ height: HEIGHT }}
        >
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute right-0 -translate-y-1/2"
              style={{
                top: t === 0 ? baseline : i < 2 ? baseline - px(t) : baseline + px(t),
              }}
            >
              {formatCount(t)}
            </span>
          ))}
        </div>

        <div
          className="relative min-w-0 flex-1"
          style={{ height: HEIGHT }}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t, i) => (
            <div
              key={i}
              className={cn(
                'absolute inset-x-0 h-px',
                t === 0 ? 'bg-[var(--axis)]' : 'bg-[var(--grid)]',
              )}
              style={{
                top: t === 0 ? baseline : i < 2 ? baseline - px(t) : baseline + px(t),
              }}
            />
          ))}

          <div className="absolute inset-0 flex">
            {buckets.map((b, i) => (
              <div
                key={b.start}
                className={cn(
                  'relative h-full flex-1 rounded-md transition-colors',
                  active === i && 'bg-sunken/70',
                )}
                onMouseEnter={() => setActive(i)}
              >
                <div
                  className="absolute inset-x-[18%] rounded-t-[4px] transition-[height] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
                  style={{
                    bottom: HEIGHT - baseline,
                    height: pxUp(b.succeeded),
                    background: STATUS.SUCCEEDED.color,
                  }}
                />
                {b.succeeded > up && (
                  <>
                    {/* The break: a surface-coloured notch near the top of the clipped bar. */}
                    <div className="absolute inset-x-[10%] top-[10px] h-[3px] -skew-y-12 bg-panel" />
                    <span className="absolute inset-x-0 -top-4 text-center text-[10px] font-semibold text-ink tabular-nums">
                      {formatCount(b.succeeded)}
                    </span>
                  </>
                )}
                <div
                  className="absolute inset-x-[18%] rounded-b-[4px] transition-[height] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
                  style={{
                    top: baseline + 1,
                    height: Math.max(0, pxDown(b.failed) - (b.cancelled ? 2 : 0)),
                    background: STATUS.FAILED.color,
                  }}
                />
                <div
                  className="absolute inset-x-[18%] rounded-b-[4px] transition-[height,top] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
                  style={{
                    top: baseline + 1 + pxDown(b.failed),
                    height: Math.max(
                      0,
                      pxDown(b.failed + b.cancelled) - pxDown(b.failed),
                    ),
                    background: STATUS.CANCELLED.color,
                  }}
                />
                {b.failed + b.cancelled > down && (
                  <>
                    <div className="absolute inset-x-[10%] bottom-[10px] h-[3px] -skew-y-12 bg-panel" />
                    <span className="absolute inset-x-0 -bottom-4 text-center text-[10px] font-semibold text-ink tabular-nums">
                      {formatCount(b.failed + b.cancelled)}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 100 ${HEIGHT}`}
            preserveAspectRatio="none"
          >
            <polyline
              points={linePoints}
              fill="none"
              stroke="var(--ink-2)"
              strokeWidth="2"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>

          {active !== null && hovered && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 w-[188px] animate-fade-in rounded-xl bg-panel px-3 py-2.5 text-xs shadow-float"
              style={{
                left: `clamp(0px, calc(${((active + 0.5) / n) * 100}% - 94px), calc(100% - 188px))`,
              }}
            >
              <p className="font-semibold text-ink">
                {tickLabel
                  ? label(hovered.start, active)
                  : `${formatClock(hovered.start, withDay)}–${formatClock(
                      new Date(
                        new Date(hovered.start).getTime() + bucketMs,
                      ).toISOString(),
                    )}`}
              </p>
              <dl className="mt-1.5 space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Accepted</dt>
                  <dd className="font-medium text-ink tabular-nums">
                    {formatCount(hovered.created)}
                  </dd>
                </div>
                {SERIES.map(({ key, label, color }) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-ink-2">
                      <span
                        className="size-2 rounded-[2px]"
                        style={{ background: color }}
                      />
                      {label}
                    </dt>
                    <dd className="font-medium text-ink tabular-nums">
                      {formatCount(hovered[key])}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Retried attempts</dt>
                  <dd className="font-medium text-ink tabular-nums">
                    {formatCount(hovered.retries)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex pl-10 text-[11px] text-ink-3 tabular-nums" aria-hidden>
        {buckets.map((b, i) => (
          <span key={b.start} className="flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 ? label(b.start, i) : ''}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>
          Payment outcomes per{' '}
          {bucketMs >= 60_000
            ? `${Math.round(bucketMs / 60_000)} minutes`
            : `${Math.round(bucketMs / 1000)} seconds`}
        </caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">Accepted</th>
            <th scope="col">Succeeded</th>
            <th scope="col">Failed</th>
            <th scope="col">Cancelled</th>
            <th scope="col">Retried attempts</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.start}>
              <th scope="row">{label(b.start, buckets.indexOf(b))}</th>
              <td>{b.created}</td>
              <td>{b.succeeded}</td>
              <td>{b.failed}</td>
              <td>{b.cancelled}</td>
              <td>{b.retries}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
