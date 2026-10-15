'use client';

import type { PaymentStreamMessage } from '@payment-sim/shared';
import { PaymentEventType } from '@payment-sim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { queryKeys, rememberEvent, rememberPayment } from './queries';
import type { StreamState } from './use-event-stream';
import { useEventStream } from './use-event-stream';

export const STREAM_EVENTS = Object.values(PaymentEventType);

/**
 * The dashboard's live feed. Rows already on screen are patched in place immediately; new
 * payments and the aggregates are refetched, at most once a second, so a burst of events
 * (the load simulator) does not turn into a burst of requests.
 */
export function useLiveDashboard(): StreamState {
  const client = useQueryClient();
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(pending.current), []);

  const refreshAggregates = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      void client.invalidateQueries({ queryKey: [...queryKeys.payments, 'list'] });
      void client.invalidateQueries({ queryKey: queryKeys.stats });
    }, 1000);
  }, [client]);

  return useEventStream('/api/v1/stream', STREAM_EVENTS, (_name, data) => {
    const message = data as PaymentStreamMessage;
    rememberPayment(client, message.payment);
    rememberEvent(client, message.event);
    refreshAggregates();
  });
}
