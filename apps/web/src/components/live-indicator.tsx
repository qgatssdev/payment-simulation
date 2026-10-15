import type { StreamState } from '@/lib/use-event-stream';
import { cn } from '@/lib/cn';

const COPY: Record<StreamState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
};

export function LiveIndicator({ state }: { state: StreamState }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-xs text-ink-2">
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          state === 'live' ? 'bg-good' : 'bg-warning',
          state !== 'live' && 'animate-pulse',
        )}
      />
      {COPY[state]}
    </span>
  );
}
