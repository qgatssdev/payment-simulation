'use client';

import type { PaymentStatus } from '@payment-sim/shared';
import { PAYMENT_STATUSES } from '@payment-sim/shared';
import { useState } from 'react';
import { STATUS_LABEL } from './status-badge';

/**
 * Payments by status, in lifecycle order. One series, so one hue: the status names are the
 * identity, the bar length is the magnitude. Built from HTML rather than a scaled SVG so text
 * keeps its real size on a phone. Bars are capped at 20px with a 4px rounded data end and a
 * square baseline end; values sit at the tips in text colour; every row has a hover/focus
 * tooltip; a table carries the same numbers for assistive tech.
 */
export function StatusChart({ counts }: { counts: Record<PaymentStatus, number> }) {
  const [active, setActive] = useState<PaymentStatus | null>(null);
  const total = PAYMENT_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const max = Math.max(1, ...PAYMENT_STATUSES.map((s) => counts[s]));
  const share = (n: number) => (total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`);

  return (
    <div>
      <ul aria-hidden className="space-y-1">
        {PAYMENT_STATUSES.map((status) => {
          const n = counts[status];
          const width = `${(n / max) * 100}%`;
          return (
            <li
              key={status}
              tabIndex={0}
              onMouseEnter={() => setActive(status)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(status)}
              onBlur={() => setActive(null)}
              className="relative grid grid-cols-[88px_1fr] items-center gap-3 rounded-md px-1 py-1.5 outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              <span className="text-right text-xs text-ink-2">
                {STATUS_LABEL[status]}
              </span>
              <span className="flex items-center gap-2 border-l border-line">
                {/* Leave room for the value label so the longest bar never collides with it. */}
                <span className="flex min-w-0 flex-1 items-center">
                  <span
                    className="h-5 rounded-r-[4px] bg-accent"
                    style={{ width: n === 0 ? 0 : `max(2px, ${width})` }}
                  />
                  <span className="ml-2 text-xs font-semibold tabular-nums text-ink">
                    {n}
                  </span>
                </span>
              </span>
              {active === status && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute -top-8 right-1 z-10 rounded-md border border-line bg-surface px-2.5 py-1 text-xs whitespace-nowrap shadow-sm"
                >
                  <span className="font-medium text-ink">{STATUS_LABEL[status]}</span>
                  <span className="ml-2 tabular-nums text-ink-2">
                    {n} · {share(n)} of {total}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <table className="sr-only">
        <caption>Payments by status</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Payments</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {PAYMENT_STATUSES.map((status) => (
            <tr key={status}>
              <th scope="row">{STATUS_LABEL[status]}</th>
              <td>{counts[status]}</td>
              <td>{share(counts[status])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
