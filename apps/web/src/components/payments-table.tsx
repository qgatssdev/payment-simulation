'use client';

import type { Currency, PaymentStatus } from '@payment-sim/shared';
import { PAYMENT_STATUSES, SUPPORTED_CURRENCIES } from '@payment-sim/shared';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePaymentList } from '@/lib/queries';
import { STATUS_LABEL, StatusBadge } from './status-badge';
import { Button } from './ui/button';
import { Card, CardHeader } from './ui/card';
import { SelectField } from './ui/field';
import { Skeleton } from './ui/skeleton';

export function PaymentsTable() {
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const query = usePaymentList({
    status: status || undefined,
    currency: currency || undefined,
    limit: 15,
  });
  const payments = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Card aria-labelledby="payments-heading">
      <CardHeader
        id="payments-heading"
        title="Payments"
        description="Newest first. Rows update live as payments move through their lifecycle."
        actions={
          <div className="flex gap-2">
            <SelectField
              label="Status"
              className="w-36"
              value={status}
              onChange={(e) => setStatus(e.target.value as PaymentStatus | '')}
            >
              <option value="">All statuses</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Currency"
              className="w-28"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency | '')}
            >
              <option value="">All</option>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          </div>
        }
      />

      {query.isError ? (
        <div role="alert" className="rounded-lg border border-critical/30 p-4 text-sm">
          <p className="font-medium text-critical-ink">Could not load payments.</p>
          <p className="mt-1 text-ink-2">{query.error.message}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm [&_td]:whitespace-nowrap">
            <caption className="sr-only">Payments, newest first</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th scope="col" className="px-5 py-2 font-medium">
                  Payment
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Card
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Attempts
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {query.isPending &&
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={7} className="px-5 py-3">
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))}
              {payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-line last:border-0 hover:bg-surface-2"
                >
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/payments/${p.id}`}
                      // A long, live-updating list: prefetching every row's page is waste.
                      prefetch={false}
                      className="font-medium text-accent-ink hover:underline"
                      aria-label={`Open payment ${p.description ?? p.id}`}
                    >
                      {p.description ?? `${p.id.slice(0, 8)}…`}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{p.customerEmail}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(p.amount, p.currency)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">
                    <span className="capitalize">{p.paymentMethod.brand}</span> ····{' '}
                    {p.paymentMethod.last4}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                    {p.attempts}
                  </td>
                  <td className="px-5 py-2.5 text-ink-2">
                    {formatDateTime(p.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.isSuccess && payments.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-ink-2">
              No payments yet.{' '}
              <Link href="/payments/new" className="text-accent-ink underline">
                Create one
              </Link>{' '}
              or run the load simulator.
            </p>
          )}
        </div>
      )}

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </Card>
  );
}
