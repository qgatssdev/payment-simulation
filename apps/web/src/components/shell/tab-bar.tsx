'use client';

import { BookOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { API_URL } from '@/lib/config';
import { cn } from '@/lib/cn';
import { NAV } from './nav';
import { useShell } from './shell-context';

/** Phone navigation: a frosted bar at the bottom, New payment raised in the middle. */
export function TabBar() {
  const pathname = usePathname();
  const { openNewPayment } = useShell();
  const [overview, payments, simulator] = NAV;
  const tab = (item: (typeof NAV)[number]) => {
    const active = item.match(pathname) && pathname !== '/payments/new';
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'pressable flex flex-1 flex-col items-center gap-1 pt-2 pb-1 text-[11px] font-medium',
          active ? 'text-brand-ink' : 'text-ink-3',
        )}
      >
        <Icon className="size-[22px]" aria-hidden />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-[color-mix(in_oklab,var(--panel)_78%,transparent)] pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-end px-2">
        {tab(overview!)}
        {tab(payments!)}
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={openNewPayment}
            aria-label="New payment"
            className="pressable -mt-5 flex size-14 items-center justify-center rounded-[20px] bg-brand text-on-brand shadow-brand"
          >
            <Plus className="size-6" aria-hidden />
          </button>
        </div>
        {tab(simulator!)}
        <a
          href={`${API_URL}/docs`}
          target="_blank"
          rel="noreferrer"
          className="pressable flex flex-1 flex-col items-center gap-1 pt-2 pb-1 text-[11px] font-medium text-ink-3"
        >
          <BookOpen className="size-[22px]" aria-hidden />
          Docs
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </nav>
  );
}
