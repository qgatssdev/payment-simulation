'use client';

import type { InsightsView } from '@payment-sim/shared';
import { PaymentFailureCode } from '@payment-sim/shared';
import { TermDot } from '@/common/statusBadge';
import { formatCount } from '@/utils/format';
import { REASON, REASON_ORDER, STATUS } from '@/utils/vocabulary';

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="relative block h-2.5 flex-1 overflow-hidden rounded-full bg-sunken">
      <span
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
        style={{
          width: value === 0 ? 0 : `max(6px, ${(value / Math.max(1, max)) * 100}%)`,
          background: color,
        }}
      />
    </span>
  );
}

/** Why payments failed: final failure reasons in the window, in the reasons' fixed order. */
export function FailureReasons({ failures }: { failures: InsightsView['failures'] }) {
  const byCode = new Map(failures.byCode.map((c) => [c.code, c.count]));
  const total = failures.byCode.reduce((n, c) => n + c.count, 0);
  const max = Math.max(...failures.byCode.map((c) => c.count), 1);
  const other = byCode.get(PaymentFailureCode.EXPIRED_CARD) ?? 0;
  const rows = [
    ...REASON_ORDER.map((code) => ({ code, count: byCode.get(code) ?? 0 })),
    ...(other ? [{ code: PaymentFailureCode.EXPIRED_CARD, count: other }] : []),
  ];

  return (
    <ul className="space-y-3.5" aria-label="Failed payments by reason">
      {rows.map(({ code, count }) => {
        const term = REASON[code];
        return (
          <li key={code} className="flex items-center gap-3">
            <TermDot color={term.color} icon={term.icon} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate font-medium text-ink">{term.label}</span>
                <span className="shrink-0 text-ink-2 tabular-nums">
                  <span className="font-semibold text-ink">{formatCount(count)}</span>
                  {total > 0 && ` · ${Math.round((count / total) * 100)}%`}
                </span>
              </div>
              <div className="mt-1.5 flex">
                <Bar value={count} max={max} color={term.color} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** What retries bought: approvals rescued, payments that ran out of attempts, and why. */
export function RetryOutcomes({ failures }: { failures: InsightsView['failures'] }) {
  const retried = failures.recoveredByRetry + failures.failedAfterRetries;
  const rescue = retried ? Math.round((failures.recoveredByRetry / retried) * 100) : null;
  const retryCodes = REASON_ORDER.filter((c) => REASON[c].retryable);
  const counts = new Map(failures.retriesByCode.map((c) => [c.code, c.count]));
  const totalRetries = retryCodes.reduce((n, c) => n + (counts.get(c) ?? 0), 0);

  return (
    <div>
      <p className="text-[40px] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
        {rescue === null ? '—' : `${rescue}%`}
      </p>
      <p className="mt-2 text-[13px] text-ink-2">
        {retried === 0
          ? 'No payment needed a retry in this window.'
          : `of ${formatCount(retried)} payments that needed a retry were approved in the end.`}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-[13px]">
        <div className="flex items-center gap-2.5">
          <TermDot color={STATUS.SUCCEEDED.color} icon={STATUS.SUCCEEDED.icon} />
          <div>
            <dt className="text-ink-2">Rescued</dt>
            <dd className="font-semibold text-ink tabular-nums">
              {formatCount(failures.recoveredByRetry)}
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <TermDot color={STATUS.FAILED.color} icon={STATUS.FAILED.icon} />
          <div>
            <dt className="text-ink-2">Ran out of attempts</dt>
            <dd className="font-semibold text-ink tabular-nums">
              {formatCount(failures.failedAfterRetries)}
            </dd>
          </div>
        </div>
      </dl>
      <p className="mt-5 text-xs font-medium text-ink-2">Retried attempts by cause</p>
      <div
        className="mt-2 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-sunken"
        aria-hidden
      >
        {retryCodes.map((code) => {
          const n = counts.get(code) ?? 0;
          return n ? (
            <span
              key={code}
              className="h-full transition-[flex-grow] duration-500"
              style={{ flexGrow: n, background: REASON[code].color }}
            />
          ) : null;
        })}
      </div>
      <ul className="mt-2.5 space-y-1 text-[13px]">
        {retryCodes.map((code) => {
          const term = REASON[code];
          const Icon = term.icon;
          const n = counts.get(code) ?? 0;
          return (
            <li key={code} className="flex items-center gap-2">
              <Icon className="size-3.5" style={{ color: term.color }} aria-hidden />
              <span className="flex-1 text-ink-2">{term.label}</span>
              <span className="font-medium text-ink tabular-nums">
                {formatCount(n)}
                {totalRetries > 0 && (
                  <span className="font-normal text-ink-3">
                    {' '}
                    · {Math.round((n / totalRetries) * 100)}%
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Gateway attempts each settled payment used, with how many of each ended approved. */
export function AttemptsDistribution({
  failures,
}: {
  failures: InsightsView['failures'];
}) {
  const rows = failures.attempts.filter((r) => r.attempts > 0);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.succeeded, r.failed)));
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-2">No payments settled in this window.</p>;
  }
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-2">
        {[STATUS.SUCCEEDED, STATUS.FAILED].map((t) => (
          <span key={t.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: t.color }}
            />
            {t.label === 'Succeeded' ? 'Approved' : 'Failed'}
          </span>
        ))}
      </div>
      <ul className="space-y-4" aria-label="Settled payments by gateway attempts used">
        {rows.map((r) => (
          <li key={r.attempts} className="grid grid-cols-[72px_1fr] items-center gap-3">
            <span className="text-[13px] text-ink-2">
              {r.attempts} {r.attempts === 1 ? 'attempt' : 'attempts'}
            </span>
            {/* Two separate bars, not one stacked bar: green and red never touch. */}
            <span className="space-y-1.5">
              <span className="flex items-center gap-2">
                <Bar value={r.succeeded} max={max} color={STATUS.SUCCEEDED.color} />
                <span className="w-10 text-right text-xs font-medium text-ink tabular-nums">
                  {formatCount(r.succeeded)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Bar value={r.failed} max={max} color={STATUS.FAILED.color} />
                <span className="w-10 text-right text-xs font-medium text-ink tabular-nums">
                  {formatCount(r.failed)}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
