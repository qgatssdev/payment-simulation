'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/config';

export type StreamState = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribe to a Server-Sent Events endpoint of the API. EventSource reconnects by itself
 * and sends Last-Event-ID, so the server replays whatever was missed while disconnected.
 */
export function useEventStream(
  path: string | null,
  eventNames: readonly string[],
  onEvent: (name: string, data: unknown) => void,
): StreamState {
  // State is recorded with the stream it describes, so switching paths reads as
  // "connecting" until the new stream reports, without resetting state inside the effect.
  const [status, setStatus] = useState<{ path: string | null; state: StreamState }>({
    path,
    state: 'connecting',
  });
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  const names = eventNames.join(',');
  useEffect(() => {
    if (!path) return;
    const source = new EventSource(`${API_URL}${path}`);
    source.onopen = () => setStatus({ path, state: 'live' });
    source.onerror = () => setStatus({ path, state: 'reconnecting' });

    const listeners = names.split(',').map((name) => {
      const listener = (message: MessageEvent<string>) => {
        try {
          handler.current(name, JSON.parse(message.data) as unknown);
        } catch {
          // A malformed frame is skipped; the next one still applies.
        }
      };
      source.addEventListener(name, listener);
      return [name, listener] as const;
    });

    return () => {
      for (const [name, listener] of listeners)
        source.removeEventListener(name, listener);
      source.close();
    };
  }, [path, names]);

  return status.path === path ? status.state : 'connecting';
}
