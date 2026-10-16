'use client';

import type {
  PaymentEventView,
  PaymentFailureCode,
  PaymentView,
} from '@payment-sim/shared';
import { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import { CircleDashed } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMs } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { REASON, STATUS } from '@/lib/vocabulary';
import { EmptyState } from '../ui/states';

interface Attempt {
  n: number;
  start: number;
  end: number;
  outcome: 'retried' | 'approved' | 'declined' | 'gave-up' | 'running';
  code?: PaymentFailureCode;
  /** When the retry was scheduled for, for the backoff that follows a retried attempt. */
  retryAt?: number;
}

const time = (iso: unknown) =>
  typeof iso === 'string' ? new Date(iso).getTime() : undefined;

/**
 * Rebuild the gateway attempts from the audit log. Events carry when each call started and how
 * long it ran (older events without timings fall back to the event times).
 */
export function attemptsFrom(
  payment: PaymentView,
  events: PaymentEventView[],
  now: number,
) {
  const created = new Date(payment.createdAt).getTime();
  const processing = events.find((e) => e.toStatus === PaymentStatus.PROCESSING);
  const pickedUp = processing ? new Date(processing.createdAt).getTime() : undefined;
  const attempts: Attempt[] = [];
  let nextStart = pickedUp;

  for (const e of events) {
    const isRetry = e.type === PaymentEventType.ATTEMPT_FAILED;
    const isFinal =
      e.type === PaymentEventType.STATUS_CHANGED &&
      (e.toStatus === PaymentStatus.SUCCEEDED || e.toStatus === PaymentStatus.FAILED);
    if (!isRetry && !isFinal) continue;
    const at = new Date(e.createdAt).getTime();
    const start = time(e.metadata.startedAt) ?? nextStart ?? at;
    const duration =
      typeof e.metadata.durationMs === 'number' ? e.metadata.durationMs : at - start;
    const code = e.metadata.code as PaymentFailureCode | undefined;
    attempts.push({
      n:
        typeof e.metadata.attempt === 'number' ? e.metadata.attempt : attempts.length + 1,
      start,
      end: start + Math.max(0, duration),
      outcome: isRetry
        ? 'retried'
        : e.toStatus === PaymentStatus.SUCCEEDED
          ? 'approved'
          : code && REASON[code]?.retryable
            ? 'gave-up'
            : 'declined',
      code,
      retryAt: time(e.metadata.retryAt),
    });
    nextStart = time(e.metadata.retryAt);
  }

  // Still processing: the call in flight now, or the backoff before the next one.
  const last = attempts.at(-1);
  if (
    payment.status === PaymentStatus.PROCESSING &&
    (!last || last.outcome === 'retried')
  ) {
    const start = last ? (last.retryAt ?? last.end) : (pickedUp ?? created);
    if (now >= start) {
      attempts.push({ n: (last?.n ?? 0) + 1, start, end: now, outcome: 'running' });
    }
  }
  const end = Math.max(
    payment.processedAt ? new Date(payment.processedAt).getTime() : 0,
    ...attempts.map((a) => Math.max(a.end, a.retryAt ?? 0)),
    payment.status === PaymentStatus.PROCESSING ? now : 0,
    pickedUp ?? created,
  );
  return { created, pickedUp, attempts, end };
}

function colorOf(a: Attempt): string {
  if (a.outcome === 'approved') return STATUS.SUCCEEDED.color;
  if (a.outcome === 'running') return STATUS.PROCESSING.color;
  return a.code ? REASON[a.code].color : STATUS.FAILED.color;
}

function resultOf(a: Attempt): string {
  switch (a.outcome) {
    case 'approved':
      return 'Approved';
    case 'running':
      return 'In progress';
    case 'retried':
      return `${a.code ? REASON[a.code].label : 'Failed'}, retried`;
    case 'gave-up':
      return `${a.code ? REASON[a.code].label : 'Failed'}, out of attempts`;
    default:
      return a.code ? REASON[a.code].label : 'Declined';
  }
}

/**
 * Every gateway call drawn to scale on one time axis, from acceptance to the final answer:
 * the wait in the queue, each attempt (coloured by how it ended), and the backoff gaps the
 * worker waited between retries.
 */
export function AttemptTimeline({
  payment,
  events,
}: {
  payment: PaymentView;
  events: PaymentEventView[];
}) {
  const now = useNow(payment.status === PaymentStatus.PROCESSING ? 250 : 60_000);
  const { created, pickedUp, attempts, end } = attemptsFrom(payment, events, now);

  if (attempts.length === 0) {
    const pending = payment.status === PaymentStatus.PENDING;
    return (
      <EmptyState
        icon={CircleDashed}
        title={pending ? 'Waiting for the worker' : 'No gateway attempts'}
      >
        {pending
          ? 'The worker will charge the gateway shortly; attempts appear here as they happen.'
          : `This payment was ${STATUS[payment.status].label.toLowerCase()} before the gateway was called.`}
      </EmptyState>
    );
  }

  const span = Math.max(1, end - created);
  const pct = (t: number) => `${((t - created) / span) * 100}%`;
  const width = (a: number, b: number) => `max(3px, ${((b - a) / span) * 100}%)`;

  return (
    <div>
      <div className="relative h-14" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--grid)]" />
        {pickedUp !== undefined && pickedUp > created && (
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-sunken"
            style={{ left: 0, width: width(created, pickedUp) }}
            title={`Queued ${formatMs(pickedUp - created)}`}
          />
        )}
        {attempts.map((a, i) => {
          const next = attempts[i + 1];
          return (
            <div key={a.n}>
              <div
                className={cn(
                  'absolute top-1/2 h-6 -translate-y-1/2 rounded-[6px]',
                  a.outcome === 'running' && 'animate-pulse',
                )}
                style={{
                  left: pct(a.start),
                  width: width(a.start, a.end),
                  background: colorOf(a),
                }}
              />
              {next && next.start > a.end && (
                <div
                  className="absolute top-1/2 border-t-2 border-dashed border-[var(--axis)]"
                  style={{ left: pct(a.end), width: width(a.end, next.start) }}
                />
              )}
              <span
                className="absolute top-0 -translate-x-1/2 text-[11px] font-medium text-ink-2 tabular-nums"
                style={{
                  left: `calc(${pct(a.start)} + ${((a.end - a.start) / span) * 50}%)`,
                }}
              >
                #{a.n}
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="mt-1 flex justify-between text-[11px] text-ink-3 tabular-nums"
        aria-hidden
      >
        <span>Accepted</span>
        <span>{formatMs(span / 2)}</span>
        <span>{formatMs(span)}</span>
      </div>

      <table className="mt-5 w-full text-[13px] [&_td]:align-top [&_th]:whitespace-nowrap">
        <caption className="sr-only">Gateway attempts</caption>
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th scope="col" className="pr-3 pb-2 font-medium">
              Attempt
            </th>
            <th scope="col" className="pb-2 pr-2 font-medium">
              Started
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Took
            </th>
            <th scope="col" className="pb-2 pl-4 font-medium">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a, i) => {
            const prev = attempts[i - 1];
            return (
              <tr key={a.n} className="border-t border-hairline">
                <td className="py-2 font-medium text-ink tabular-nums">#{a.n}</td>
                <td className="py-2 pr-2 whitespace-nowrap text-ink-2 tabular-nums">
                  +{formatMs(a.start - created)}
                  {prev && a.start > prev.end && (
                    <span className="block text-xs text-ink-3">
                      after {formatMs(a.start - prev.end)} backoff
                    </span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap text-ink-2 tabular-nums">
                  {formatMs(a.end - a.start)}
                </td>
                <td className="py-2 pl-4">
                  <span className="inline-flex items-start gap-2 text-ink">
                    <span
                      aria-hidden
                      className="mt-1 size-2.5 shrink-0 rounded-[3px]"
                      style={{ background: colorOf(a) }}
                    />
                    {resultOf(a)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
