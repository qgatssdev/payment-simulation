'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BookOpen,
  CornerDownLeft,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Monitor,
  Moon,
  Plus,
  Search,
  Sun,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { setTheme } from '@/lib/theme';
import { STATUS } from '@/lib/vocabulary';

interface Item {
  id: string;
  group: 'Payments' | 'Go to' | 'Actions';
  label: string;
  hint?: string;
  icon: LucideIcon;
  iconColor?: string;
  run: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * ⌘K: jump to a payment by id (or by text in its email or description), open a page, or run a
 * common action. A combobox with a listbox; arrows move, Enter runs, Escape closes.
 */
export function CommandPalette({
  open,
  onClose,
  onNewPayment,
}: {
  open: boolean;
  onClose: () => void;
  onNewPayment: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const q = useDebounced(query.trim(), 160);

  const search = useQuery({
    queryKey: ['payments', 'list', { q, limit: 6, palette: true }],
    queryFn: () => api.listPayments({ q, limit: 6 }),
    enabled: open && q.length >= 2,
    staleTime: 5_000,
  });

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => router.push(href);
    const results: Item[] = [];
    if (UUID.test(q) && !search.data?.data.some((p) => p.id === q.toLowerCase())) {
      results.push({
        id: `open-${q}`,
        group: 'Payments',
        label: `Open payment ${q.slice(0, 8)}…`,
        hint: 'by id',
        icon: ArrowRight,
        run: go(`/payments/${q.toLowerCase()}`),
      });
    }
    for (const p of q.length >= 2 ? (search.data?.data ?? []) : []) {
      results.push({
        id: p.id,
        group: 'Payments',
        label: p.description ?? p.id,
        hint: `${formatMoney(p.amount, p.currency)} · ${STATUS[p.status].label}`,
        icon: STATUS[p.status].icon,
        iconColor: STATUS[p.status].color,
        run: go(`/payments/${p.id}`),
      });
    }
    const commands: Item[] = [
      {
        id: 'overview',
        group: 'Go to',
        label: 'Overview',
        icon: LayoutDashboard,
        run: go('/'),
      },
      {
        id: 'payments',
        group: 'Go to',
        label: 'Payments',
        icon: ListOrdered,
        run: go('/payments'),
      },
      {
        id: 'failed',
        group: 'Go to',
        label: 'Failed payments',
        icon: STATUS.FAILED.icon,
        iconColor: STATUS.FAILED.color,
        run: go('/payments?status=FAILED'),
      },
      {
        id: 'simulator',
        group: 'Go to',
        label: 'Load simulator',
        icon: Gauge,
        run: go('/simulator'),
      },
      {
        id: 'docs',
        group: 'Go to',
        label: 'API docs',
        hint: 'opens in a new tab',
        icon: BookOpen,
        run: () => window.open(`${API_URL}/docs`, '_blank', 'noreferrer'),
      },
      {
        id: 'new',
        group: 'Actions',
        label: 'New payment',
        icon: Plus,
        run: onNewPayment,
      },
      {
        id: 'light',
        group: 'Actions',
        label: 'Light theme',
        icon: Sun,
        run: () => setTheme('light'),
      },
      {
        id: 'dark',
        group: 'Actions',
        label: 'Dark theme',
        icon: Moon,
        run: () => setTheme('dark'),
      },
      {
        id: 'auto',
        group: 'Actions',
        label: 'Theme follows the system',
        icon: Monitor,
        run: () => setTheme('auto'),
      },
    ];
    const needle = q.toLowerCase();
    return [
      ...results,
      ...commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)),
    ];
  }, [q, search.data, router, onNewPayment]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setQuery('');
      setActive(0);
      input.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const selected = Math.min(active, Math.max(0, items.length - 1));
  const runItem = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  let lastGroup: string | undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-[var(--scrim)]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
        className="relative w-full max-w-[600px] animate-pop-in overflow-hidden rounded-[24px] bg-panel shadow-float"
      >
        <div className="flex items-center gap-3 px-5">
          <Search className="size-5 shrink-0 text-ink-3" aria-hidden />
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              items[selected] ? `${listId}-${items[selected].id}` : undefined
            }
            aria-label="Search payments or type a command"
            placeholder="Payment id, email or description, or a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runItem(items[selected]);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            className="h-16 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="hidden rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-3 sm:block">
            esc
          </kbd>
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[55vh] overflow-y-auto border-t border-hairline p-2"
        >
          {search.isFetching && q.length >= 2 && !search.data && (
            <li className="px-3 py-2 text-[13px] text-ink-3" role="presentation">
              Searching…
            </li>
          )}
          {items.length === 0 && (
            <li
              className="px-3 py-6 text-center text-[13px] text-ink-3"
              role="presentation"
            >
              No payments or commands match “{q}”.
            </li>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : undefined;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <li key={item.id} role="presentation">
                {header && (
                  <p
                    className="px-3 pt-2 pb-1 text-xs font-medium text-ink-3"
                    aria-hidden
                  >
                    {header}
                  </p>
                )}
                <div
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={i === selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runItem(item)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                    i === selected ? 'bg-brand-wash text-ink' : 'text-ink-2',
                  )}
                >
                  <Icon
                    className="size-4 shrink-0"
                    style={{ color: item.iconColor ?? 'var(--ink-3)' }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {item.label}
                  </span>
                  {item.hint && (
                    <span className="shrink-0 text-xs text-ink-3 tabular-nums">
                      {item.hint}
                    </span>
                  )}
                  {i === selected && (
                    <CornerDownLeft
                      className="size-3.5 shrink-0 text-ink-3"
                      aria-hidden
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
