'use client';

import { ArrowUpRight, BookOpen, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { API_URL } from '@/lib/config';
import { cn } from '@/lib/cn';
import { useStreamState } from '@/lib/live';
import { buttonClasses } from '../ui/button';
import { LiveIndicator } from './live-indicator';
import { LogoMark } from './logo';
import { NAV } from './nav';
import { useShell } from './shell-context';
import { ThemeSwitch } from './theme-switch';

/** Laptop navigation: fixed on the left, the primary action at the top. */
export function Sidebar() {
  const pathname = usePathname();
  const { openNewPayment, openPalette } = useShell();
  const stream = useStreamState();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col px-4 py-5 lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-2 text-ink">
        <LogoMark className="size-8" />
        <span className="text-[15px] leading-tight font-semibold tracking-[-0.015em]">
          Payment
          <br />
          Simulation
        </span>
      </Link>

      <button
        type="button"
        onClick={openNewPayment}
        className={buttonClasses('primary', 'mt-7 w-full', 'lg')}
      >
        <Plus className="size-4" aria-hidden />
        New payment
      </button>

      <button
        type="button"
        onClick={openPalette}
        className="pressable mt-3 flex h-10 w-full items-center gap-2.5 rounded-control bg-panel px-3 text-[13px] text-ink-3 shadow-panel hover:text-ink-2"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded-md bg-sunken px-1.5 py-0.5 font-sans text-[11px] text-ink-3">
          ⌘K
        </kbd>
      </button>

      <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active =
            match(pathname) && !(href === '/payments' && pathname === '/payments/new');
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'pressable flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium',
                active
                  ? 'bg-brand-wash text-brand-ink'
                  : 'text-ink-2 hover:bg-panel hover:text-ink',
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </Link>
          );
        })}
        <a
          href={`${API_URL}/docs`}
          target="_blank"
          rel="noreferrer"
          className="pressable flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-panel hover:text-ink"
        >
          <BookOpen className="size-[18px]" aria-hidden />
          <span className="flex-1">API docs</span>
          <ArrowUpRight className="size-3.5 text-ink-3" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </nav>

      <div className="mt-auto space-y-4 px-2">
        <LiveIndicator state={stream} />
        <ThemeSwitch />
      </div>
    </aside>
  );
}
