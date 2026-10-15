import { CreditCard, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { API_URL } from '@/lib/config';

export function AppHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 text-sm whitespace-nowrap sm:gap-6 sm:px-6"
      >
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <CreditCard className="size-5 text-accent" aria-hidden />
          <span className="sr-only sm:not-sr-only">Payment Simulation</span>
        </Link>
        <Link href="/" className="text-ink-2 hover:text-ink">
          Dashboard
        </Link>
        <Link href="/payments/new" className="text-ink-2 hover:text-ink">
          New payment
        </Link>
        <a
          href={`${API_URL}/docs`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-ink-2 hover:text-ink"
        >
          API docs
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </nav>
    </header>
  );
}
