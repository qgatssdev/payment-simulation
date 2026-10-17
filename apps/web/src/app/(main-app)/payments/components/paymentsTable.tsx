'use client';

import type { Currency, PaymentStatus, PaymentView } from '@payment-sim/shared';
import { PAYMENT_STATUSES, SUPPORTED_CURRENCIES } from '@payment-sim/shared';
import { Inbox, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/common/statusBadge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copyButton';
import { SelectField, controlClasses } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { useTouchedAt } from '@/providers/live.provider';
import { usePayments } from '@/services/payments/queries';
import { formatDateTime, formatMoney, formatRelative } from '@/utils/format';
import { STATUS_LABEL } from '@/utils/vocabulary';

/** Filters live in the URL, so a filtered view can be shared, bookmarked and reloaded. */
function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = (PAYMENT_STATUSES as readonly string[]).includes(
    params.get('status') ?? '',
  )
    ? (params.get('status') as PaymentStatus)
    : undefined;
  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(
    params.get('currency') ?? '',
  )
    ? (params.get('currency') as Currency)
    : undefined;
  const q = params.get('q') ?? '';
  const set = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const clear = () => router.replace(pathname, { scroll: false });
  return { status, currency, q, set, clear };
}

/** How recently a row changed live: the row gets a brief highlight when it does. */
function useRowTone(): (p: PaymentView) => { key: string; fresh: boolean } {
  const touchedAt = useTouchedAt();
  const now = useNow(1_000);
  return (p) => {
    const at = touchedAt(p.id);
    const fresh = at !== undefined && now - at < 2_000;
    return { key: fresh ? `${p.id}:${p.version}` : p.id, fresh };
  };
}

export function PaymentsTable() {
  const { status, currency, q, set, clear } = useFilters();
  const [search, setSearch] = useState(q);
  const query = usePayments({ status, currency, q: q || undefined, limit: 15 });
  const payments = query.data?.pages.flatMap((page) => page.data) ?? [];
  const tone = useRowTone();
  const now = useNow(15_000);
  const filtered = Boolean(status || currency || q);

  // Type freely; the URL (and the request) follow a moment later.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => set('q', search.trim() || undefined), 250);
    return () => clearTimeout(t);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="relative md:max-w-sm md:flex-1">
          <label htmlFor="payment-search" className="sr-only">
            Search payments
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input
            id="payment-search"
            type="search"
            placeholder="Search by id, email or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              controlClasses,
              'bg-panel pl-10 shadow-panel [&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className="pressable absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <SelectField
            label="Status"
            className="flex-1 md:w-40"
            value={status ?? ''}
            onChange={(e) => set('status', e.target.value || undefined)}
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
            className="flex-1 md:w-32"
            value={currency ?? ''}
            onChange={(e) => set('currency', e.target.value || undefined)}
          >
            <option value="">All</option>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <section aria-label="Payments" className="panel overflow-hidden">
        {query.isError ? (
          <ErrorState
            error={query.error}
            title="Could not load payments"
            onRetry={() => void query.refetch()}
          />
        ) : query.isSuccess && payments.length === 0 ? (
          <EmptyState
            icon={filtered ? Search : Inbox}
            title={filtered ? 'No payments match these filters' : 'No payments yet'}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    clear();
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {filtered
              ? 'Try a shorter search, or another status or currency.'
              : 'Create one with New payment, run the simulator, or seed demo data with pnpm --filter @payment-sim/api seed.'}
          </EmptyState>
        ) : (
          <>
            {/* Laptop: a table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px] [&_td]:whitespace-nowrap">
                <caption className="sr-only">Payments, newest first</caption>
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th scope="col" className="py-3 pr-3 pl-6 font-medium">
                      Payment
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Customer
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Card
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      Attempts
                    </th>
                    <th scope="col" className="py-3 pr-6 pl-3 font-medium">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.isPending &&
                    Array.from({ length: 8 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={7} className="px-6 py-2.5">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))}
                  {payments.map((p) => {
                    const { key, fresh } = tone(p);
                    return (
                      <tr
                        key={key}
                        className={cn(
                          'group border-t border-hairline hover:bg-panel-2',
                          fresh && 'animate-arrive',
                        )}
                      >
                        <td className="max-w-[300px] py-2.5 pr-3 pl-6">
                          <div className="flex items-center gap-1">
                            <div className="min-w-0">
                              <Link
                                href={`/payments/${p.id}`}
                                // A long, live-updating list: prefetching every row's page is waste.
                                prefetch={false}
                                className="block truncate font-medium text-ink hover:text-brand-ink"
                                aria-label={`Open payment ${p.description ?? p.id}`}
                              >
                                {p.description ?? 'No description'}
                              </Link>
                              <span className="font-mono text-[11px] text-ink-3">
                                {p.id.slice(0, 8)}
                              </span>
                            </div>
                            <CopyButton
                              value={p.id}
                              label="Copy payment ID"
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            />
                          </div>
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2.5 text-ink-2">
                          {p.customerEmail}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-ink tabular-nums">
                          {formatMoney(p.amount, p.currency)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="px-3 py-2.5 text-ink-2">
                          <span className="capitalize">{p.paymentMethod.brand}</span>{' '}
                          <span className="tabular-nums">
                            •••• {p.paymentMethod.last4}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">
                          {p.attempts}
                        </td>
                        <td
                          className="py-2.5 pr-6 pl-3 text-ink-2"
                          title={formatDateTime(p.createdAt)}
                        >
                          {formatRelative(p.createdAt, now)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phone: one line of what matters per payment. */}
            <ul
              className="divide-y divide-hairline md:hidden"
              aria-label="Payments, newest first"
            >
              {query.isPending &&
                Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className="px-4 py-3">
                    <Skeleton className="h-10" />
                  </li>
                ))}
              {payments.map((p) => {
                const { key, fresh } = tone(p);
                return (
                  <li key={key} className={cn(fresh && 'animate-arrive')}>
                    <Link
                      href={`/payments/${p.id}`}
                      prefetch={false}
                      aria-label={`Open payment ${p.description ?? p.id}`}
                      className="flex items-center gap-3 px-4 py-3 active:bg-panel-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {p.description ?? 'No description'}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                          <StatusBadge status={p.status} />
                          {formatRelative(p.createdAt, now)}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-ink tabular-nums">
                        {formatMoney(p.amount, p.currency)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {query.hasNextPage && (
          <div className="flex justify-center border-t border-hairline p-4">
            <Button
              variant="secondary"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
