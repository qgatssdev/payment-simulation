'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreatePaymentForm } from '../create-payment-form';
import { Sheet } from '../ui/sheet';
import { CommandPalette } from './command-palette';
import { ShellContext } from './shell-context';
import { Sidebar } from './sidebar';
import { StreamBanner } from './stream-banner';
import { TabBar } from './tab-bar';
import { TopBar } from './top-bar';

/**
 * Laptop: a fixed sidebar and a 12-column content grid. Phone: a header and a frosted bottom
 * tab bar. The new-payment sheet and the ⌘K palette open from any screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);

  const openNewPayment = useCallback(() => {
    setPalette(false);
    setSheet(true);
  }, []);
  const openPalette = useCallback(() => setPalette(true), []);
  const closeSheet = useCallback(() => setSheet(false), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const actions = useMemo(
    () => ({ openNewPayment, openPalette }),
    [openNewPayment, openPalette],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ShellContext.Provider value={actions}>
      <a
        href="#content"
        className="sr-only z-50 rounded-lg bg-panel px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <TopBar />
      <div className="lg:pl-[248px]">
        <main
          id="content"
          className="mx-auto max-w-[1320px] px-4 pt-4 pb-32 sm:px-6 lg:px-10 lg:pt-9 lg:pb-16"
        >
          <StreamBanner />
          {children}
        </main>
      </div>
      <TabBar />

      <Sheet
        open={sheet}
        onClose={closeSheet}
        title="New payment"
        description="Validated with the same rules as the API, then processed in the background."
      >
        <CreatePaymentForm
          compact
          onCreated={(id) => {
            setSheet(false);
            router.push(`/payments/${id}`);
          }}
        />
      </Sheet>
      <CommandPalette
        open={palette}
        onClose={closePalette}
        onNewPayment={openNewPayment}
      />
    </ShellContext.Provider>
  );
}
