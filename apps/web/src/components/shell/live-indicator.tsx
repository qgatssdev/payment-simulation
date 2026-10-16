'use client';

import type { StreamState } from '@/lib/use-event-stream';
import { cn } from '@/lib/cn';

const COPY: Record<StreamState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
};

/** Connection status of an event stream: a dot that breathes while live, and a word. */
export function LiveIndicator({
  state,
  className,
}: {
  state: StreamState;
  className?: string;
}) {
  return (
    // role="status" takes no name from its content, so it is labelled explicitly.
    <span
      role="status"
      aria-label={`Live updates: ${COPY[state]}`}
      className={cn(
        'inline-flex items-center gap-2 text-xs font-medium text-ink-2',
        className,
      )}
    >
      <span aria-hidden className="relative flex size-2">
        {state === 'live' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--status-succeeded)] opacity-50 [animation-duration:2.4s]" />
        )}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            state === 'live'
              ? 'bg-[var(--status-succeeded)]'
              : 'bg-[var(--reason-processing)]',
          )}
        />
      </span>
      {COPY[state]}
    </span>
  );
}
