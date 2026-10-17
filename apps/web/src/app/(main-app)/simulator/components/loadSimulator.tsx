'use client';

import type { ActivityBucketView, Currency, PaymentView } from '@payment-sim/shared';
import {
  PaymentEventType,
  PaymentStatus,
  TEST_CARDS,
  findTestCard,
} from '@payment-sim/shared';
import { Gauge, Square, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ThroughputChart } from '@/common/throughputChart';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { useLiveEvents } from '@/providers/live.provider';
import { ApiError } from '@/services/api';
import { createPayment } from '@/services/payments';
import { formatCount, formatMs, formatPercentWhole } from '@/utils/format';
import { STATUS, scenarioTerm } from '@/utils/vocabulary';

const RANDOM_CARD = '4111111111111111';
const CURRENCIES: Array<{ currency: Currency; min: number; max: number }> = [
  { currency: 'NGN', min: 150_000, max: 4_500_000 },
  { currency: 'USD', min: 900, max: 25_000 },
  { currency: 'EUR', min: 900, max: 18_000 },
  { currency: 'GBP', min: 700, max: 15_000 },
];
const nextYear = new Date().getUTCFullYear() + 1;

type Mix = 'every' | 'realistic' | 'storm';
const MIXES: Record<
  Mix,
  { label: string; description: string; weights: Array<[string, number]> }
> = {
  every: {
    label: 'Every scenario',
    description: 'Each test card in turn, plus a random card.',
    weights: [
      ...TEST_CARDS.map((c) => [c.number, 1] as [string, number]),
      [RANDOM_CARD, 1],
    ],
  },
  realistic: {
    label: 'Realistic',
    description: 'Mostly approvals, a few declines and flaky retries.',
    weights: [
      ['4242424242424242', 45],
      ['5555555555554444', 25],
      ['4000000000000002', 6],
      ['4000000000009995', 6],
      ['4000000000000119', 12],
      ['4000000000000077', 3],
      [RANDOM_CARD, 3],
    ],
  },
  storm: {
    label: 'Retry storm',
    description: 'Flaky and timing-out gateways: watch backoff at work.',
    weights: [
      ['4000000000000119', 45],
      ['4000000000000077', 25],
      ['4242424242424242', 30],
    ],
  },
};

function cardFor(mix: Mix, i: number): string {
  const weights = MIXES[mix].weights;
  if (mix === 'every') return weights[i % weights.length]![0];
  const total = weights.reduce((n, [, w]) => n + w, 0);
  let roll = Math.random() * total;
  for (const [card, w] of weights) {
    roll -= w;
    if (roll <= 0) return card;
  }
  return weights[0]![0];
}

interface Tracked {
  status: PaymentStatus;
  createdAt: string;
  processedAt: string | null;
  attempts: number;
}

interface Run {
  tag: string;
  total: number;
  startedAt: number;
  windowMs: number;
  bucketMs: number;
  sent: number;
  rejected: number;
  errors: Record<
    string,
    { status: number; count: number; requestId?: string; message: string }
  >;
  payments: Record<string, Tracked>;
  buckets: ActivityBucketView[];
  retries: number;
  sendingDone: boolean;
  stopped: boolean;
}

const TERMINAL = new Set<PaymentStatus>([
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
]);

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Fires a run of payments at the API, at once or spread over a few seconds, and follows each
 * one through the live stream: sent, in flight, outcomes over time, errors (rate limits
 * included) and a summary once every accepted payment has settled.
 */
export function LoadSimulator() {
  const [count, setCount] = useState<'10' | '25' | '50' | '100'>('25');
  const [spread, setSpread] = useState<'0' | '10' | '30'>('0');
  const [mix, setMix] = useState<Mix>('every');
  const [run, setRun] = useState<Run | null>(null);
  const stopRef = useRef(false);
  const now = useNow(500);

  const tracked = run ? Object.values(run.payments) : [];
  const settled = tracked.filter((p) => TERMINAL.has(p.status));
  const accepted = tracked.length;
  const finished = run !== null && run.sendingDone && settled.length === accepted;
  const running =
    run !== null &&
    !finished &&
    !(run.sendingDone && run.stopped && settled.length === accepted);

  const bucketIndex = (r: Run, iso: string) =>
    Math.floor((new Date(iso).getTime() - r.startedAt) / r.bucketMs);
  const bump = (r: Run, iso: string, key: keyof Omit<ActivityBucketView, 'start'>) => {
    const i = Math.min(r.buckets.length - 1, Math.max(0, bucketIndex(r, iso)));
    r.buckets = r.buckets.map((b, j) => (j === i ? { ...b, [key]: b[key] + 1 } : b));
  };

  useLiveEvents(({ event, payment }) => {
    setRun((r) => {
      if (!r) return r;
      // The stream can beat the POST response; the run's tag identifies its payments either way.
      const ours =
        r.payments[payment.id] ??
        (payment.description?.endsWith(r.tag) ? true : undefined);
      if (!ours) return r;
      const next = { ...r, payments: { ...r.payments, [payment.id]: track(payment) } };
      if (event.type === PaymentEventType.ATTEMPT_FAILED) {
        next.retries += 1;
        bump(next, event.createdAt, 'retries');
      } else if (event.toStatus === PaymentStatus.SUCCEEDED)
        bump(next, event.createdAt, 'succeeded');
      else if (event.toStatus === PaymentStatus.FAILED)
        bump(next, event.createdAt, 'failed');
      else if (event.toStatus === PaymentStatus.CANCELLED)
        bump(next, event.createdAt, 'cancelled');
      return next;
    });
  });

  function track(p: PaymentView): Tracked {
    return {
      status: p.status,
      createdAt: p.createdAt,
      processedAt: p.processedAt,
      attempts: p.attempts,
    };
  }

  async function start() {
    const total = Number(count);
    const spreadMs = Number(spread) * 1000;
    const windowMs = spreadMs + 40_000;
    const bucketMs = windowMs > 50_000 ? 2_000 : 1_000;
    const startedAt = Date.now();
    const tag = `run ${Math.random().toString(16).slice(2, 6)}`;
    stopRef.current = false;
    setRun({
      tag,
      total,
      startedAt,
      windowMs,
      bucketMs,
      sent: 0,
      rejected: 0,
      errors: {},
      payments: {},
      retries: 0,
      sendingDone: false,
      stopped: false,
      buckets: Array.from({ length: Math.ceil(windowMs / bucketMs) }, (_, i) => ({
        start: new Date(startedAt + i * bucketMs).toISOString(),
        created: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        refunded: 0,
        retries: 0,
      })),
    });

    const send = async (i: number) => {
      if (stopRef.current) return;
      const { currency, min, max } = CURRENCIES[i % CURRENCIES.length]!;
      try {
        const { payment } = await createPayment(
          {
            amount: Math.round((min + Math.random() * (max - min)) / 100) * 100,
            currency,
            customerEmail: `load-${i + 1}@example.com`,
            description: `Load test #${i + 1} · ${tag}`,
            card: {
              number: cardFor(mix, i),
              expMonth: 12,
              expYear: nextYear,
              cvc: '123',
            },
          },
          crypto.randomUUID(),
        );
        setRun((r) => {
          if (!r) return r;
          const next = {
            ...r,
            sent: r.sent + 1,
            payments: {
              ...r.payments,
              [payment.id]: r.payments[payment.id] ?? track(payment),
            },
          };
          bump(next, payment.createdAt, 'created');
          return next;
        });
      } catch (error) {
        const api = error instanceof ApiError ? error : undefined;
        const code = api?.code ?? 'UNKNOWN';
        setRun((r) => {
          if (!r) return r;
          const prev = r.errors[code];
          return {
            ...r,
            sent: r.sent + 1,
            rejected: r.rejected + 1,
            errors: {
              ...r.errors,
              [code]: {
                status: api?.status ?? 0,
                count: (prev?.count ?? 0) + 1,
                requestId: api?.requestId ?? prev?.requestId,
                message: (error as Error).message,
              },
            },
          };
        });
      }
    };

    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        spreadMs === 0
          ? send(i)
          : new Promise<void>((resolve) =>
              setTimeout(() => void send(i).then(resolve), (i * spreadMs) / total),
            ),
      ),
    );
    setRun((r) => r && { ...r, sendingDone: true, stopped: stopRef.current });
  }

  const durations = settled
    .filter((p) => p.processedAt)
    .map((p) => new Date(p.processedAt!).getTime() - new Date(p.createdAt).getTime())
    .sort((a, b) => a - b);
  const approved = settled.filter(
    (p) => p.status === PaymentStatus.SUCCEEDED || p.status === PaymentStatus.REFUNDED,
  ).length;
  const failed = settled.filter((p) => p.status === PaymentStatus.FAILED).length;
  const rescued = settled.filter(
    (p) => p.status === PaymentStatus.SUCCEEDED && p.attempts > 1,
  ).length;
  const lastSettled = settled.reduce(
    (t, p) => Math.max(t, p.processedAt ? new Date(p.processedAt).getTime() : 0),
    0,
  );
  const elapsed = run
    ? (finished ? Math.max(lastSettled, run.startedAt) : now) - run.startedAt
    : 0;

  const counters: Array<{
    label: string;
    value: number;
    color?: string;
    icon?: typeof Gauge;
  }> = [
    { label: 'Accepted', value: accepted },
    {
      label: 'In flight',
      value: accepted - settled.length,
      color: STATUS.PROCESSING.color,
      icon: STATUS.PROCESSING.icon,
    },
    {
      label: 'Approved',
      value: approved,
      color: STATUS.SUCCEEDED.color,
      icon: STATUS.SUCCEEDED.icon,
    },
    {
      label: 'Failed',
      value: failed,
      color: STATUS.FAILED.color,
      icon: STATUS.FAILED.icon,
    },
    { label: 'Rejected by the API', value: run?.rejected ?? 0 },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Card aria-labelledby="simulator-heading" className="lg:col-span-4">
        <CardHeader
          id="simulator-heading"
          title="Load simulator"
          description="Send a run of concurrent payments and follow every one of them live."
        />
        <div className="space-y-5">
          <div>
            <p id="count-label" className="mb-2 text-[13px] font-medium text-ink-2">
              Payments
            </p>
            <Segmented
              label="Payments"
              value={count}
              onChange={setCount}
              options={(['10', '25', '50', '100'] as const).map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">Send them</p>
            <Segmented
              label="Send them"
              value={spread}
              onChange={setSpread}
              options={[
                { value: '0', label: 'All at once' },
                { value: '10', label: 'Over 10 s' },
                { value: '30', label: 'Over 30 s' },
              ]}
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">Card mix</legend>
            <div className="space-y-2">
              {(Object.keys(MIXES) as Mix[]).map((m) => (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-2xl p-3 transition-colors',
                    mix === m ? 'bg-brand-wash' : 'bg-panel-2 hover:bg-sunken',
                  )}
                >
                  <input
                    type="radio"
                    name="mix"
                    value={m}
                    checked={mix === m}
                    onChange={() => setMix(m)}
                    className="mt-0.5 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">
                      {MIXES[m].label}
                    </span>
                    <span className="block text-xs text-ink-2">
                      {MIXES[m].description}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
                      {MIXES[m].weights.map(([card]) => {
                        const term = scenarioTerm(findTestCard(card));
                        const Icon = term.icon;
                        return (
                          <span
                            key={card}
                            className="flex size-5 items-center justify-center rounded-full"
                            style={{
                              background: `color-mix(in oklab, ${term.color} 16%, transparent)`,
                            }}
                          >
                            <Icon className="size-3" style={{ color: term.color }} />
                          </span>
                        );
                      })}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={() => void start()}
              disabled={running}
            >
              <Gauge className="size-4" aria-hidden />
              {running ? 'Running…' : 'Run simulation'}
            </Button>
            {running && !run?.sendingDone && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => (stopRef.current = true)}
              >
                <Square className="size-3.5" aria-hidden />
                Stop
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-3">
            The API accepts 60 writes a minute per client. Larger runs show the rate limit
            at work as rejected requests below.
          </p>
        </div>
      </Card>

      <div className="min-w-0 space-y-5 lg:col-span-8">
        <Card aria-labelledby="results-heading">
          <CardHeader
            id="results-heading"
            title={finished ? 'Run complete' : running ? 'Run in progress' : 'Results'}
            description={
              run ? (
                <span role="status">
                  {run.sent} of {run.total} sent · {accepted} accepted
                  {run.rejected > 0 && ` · ${run.rejected} rejected`}
                  {` · ${formatMs(elapsed)}`}
                </span>
              ) : (
                'Choose a run and press Run simulation. Results stream in here as the worker settles each payment.'
              )
            }
            actions={
              run && accepted > 0 ? (
                <Link
                  href={`/payments?q=${encodeURIComponent(run.tag)}`}
                  className="text-[13px] font-medium text-brand-ink hover:underline"
                >
                  See these payments
                </Link>
              ) : undefined
            }
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5">
            {counters.map((c) => (
              <div key={c.label} className="min-w-0">
                <dt className="flex items-center gap-1.5 truncate text-xs text-ink-2">
                  {c.icon && (
                    <c.icon
                      className="size-3.5 shrink-0"
                      style={{ color: c.color }}
                      aria-hidden
                    />
                  )}
                  {c.label}
                </dt>
                <dd className="mt-1 text-[28px] leading-none font-semibold tracking-[-0.025em] text-ink tabular-nums">
                  {formatCount(c.value)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-6">
            {run ? (
              <ThroughputChart
                buckets={run.buckets}
                bucketMs={run.bucketMs}
                height={200}
                tickLabel={(start) =>
                  `+${Math.round((new Date(start).getTime() - run.startedAt) / 1000)} s`
                }
              />
            ) : (
              <div className="flex h-[200px] items-center justify-center rounded-2xl bg-panel-2 text-[13px] text-ink-3">
                Outcomes per second appear here during a run.
              </div>
            )}
          </div>
        </Card>

        {run && Object.keys(run.errors).length > 0 && (
          <Card aria-labelledby="errors-heading">
            <CardHeader
              id="errors-heading"
              title="Rejected requests"
              description="Requests the API refused; nothing was created for them."
            />
            <ul className="space-y-3">
              {Object.entries(run.errors).map(([code, e]) => (
                <li
                  key={code}
                  className="flex gap-3 rounded-2xl bg-panel-2 p-3 text-[13px]"
                >
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-critical-ink"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {code} ({e.status || 'no response'}) × {e.count}
                    </p>
                    <p className="text-ink-2">
                      {code === 'RATE_LIMITED'
                        ? 'The write limit kicked in. Spread the run over more seconds or send fewer payments.'
                        : e.message}
                    </p>
                    {e.requestId && (
                      <p className="mt-1 font-mono text-[11px] text-ink-3">
                        last request {e.requestId}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {finished && accepted > 0 && (
          <Card aria-labelledby="summary-heading" className="animate-pop-in">
            <CardHeader id="summary-heading" title="Summary" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-[13px] sm:grid-cols-3">
              {[
                [
                  'Approval rate',
                  formatPercentWhole(approved / Math.max(1, approved + failed)),
                ],
                [
                  'Accepted per second',
                  (
                    accepted /
                    Math.max(
                      1,
                      (run.sendingDone
                        ? Math.max(1000, Number(spread) * 1000)
                        : elapsed) / 1000,
                    )
                  ).toFixed(accepted >= 10 ? 0 : 1),
                ],
                ['Time to final state', `${formatMs(percentile(durations, 0.5))} median`],
                ['Slowest 5%', formatMs(percentile(durations, 0.95))],
                ['Retried attempts', formatCount(run.retries)],
                ['Rescued by retry', formatCount(rescued)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}
