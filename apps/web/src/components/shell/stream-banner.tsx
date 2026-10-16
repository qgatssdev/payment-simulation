'use client';

import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStreamState } from '@/lib/live';

/**
 * Shown when the live stream has been down for a few seconds: numbers may be stale until it
 * reconnects (EventSource retries by itself and the server replays what was missed).
 */
export function StreamBanner() {
  const state = useStreamState();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (state !== 'reconnecting') {
      const t = setTimeout(() => setShow(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShow(true), 2500);
    return () => clearTimeout(t);
  }, [state]);

  if (!show) return null;
  return (
    <div
      role="status"
      className="panel mb-6 flex animate-pop-in items-center gap-3 px-4 py-3 text-[13px] text-ink-2"
    >
      <LoaderCircle className="size-4 shrink-0 animate-spin text-ink-3" aria-hidden />
      <p>
        <span className="font-medium text-ink">Live updates paused.</span> Reconnecting to
        the API; figures may be a few seconds old. Missed events replay automatically when
        it is back.
      </p>
    </div>
  );
}
