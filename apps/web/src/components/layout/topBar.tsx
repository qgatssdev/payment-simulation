'use client';

import { Moon, Search, Sun } from 'lucide-react';
import Link from 'next/link';
import { useStreamState } from '@/providers/live.provider';
import { useIsDark, useTheme } from '@/utils/theme';
import { BrandMark } from './brandMark';
import { LiveIndicator } from './liveIndicator';
import { useShell } from './shellContext';

/** Phone header: the mark, live status, search and a theme toggle. */
export function TopBar() {
  const { openPalette } = useShell();
  const stream = useStreamState();
  const [, setTheme] = useTheme();
  const dark = useIsDark();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-[color-mix(in_oklab,var(--page)_82%,transparent)] px-4 backdrop-blur-xl lg:hidden">
      <Link href="/" aria-label="Payment Simulation, overview">
        <BrandMark className="size-8" />
      </Link>
      <LiveIndicator state={stream} />
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={openPalette}
          aria-label="Search or jump to"
          className="pressable flex size-10 items-center justify-center rounded-xl text-ink-2 hover:bg-sunken"
        >
          <Search className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="pressable flex size-10 items-center justify-center rounded-xl text-ink-2 hover:bg-sunken"
        >
          {dark ? (
            <Sun className="size-5" aria-hidden />
          ) : (
            <Moon className="size-5" aria-hidden />
          )}
        </button>
      </div>
    </header>
  );
}
