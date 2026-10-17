'use client';

import type { PaymentStreamMessage } from '@payment-sim/shared';
import { PaymentEventType } from '@payment-sim/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { StreamState } from '@/hooks/useEventStream';
import { useEventStream } from '@/hooks/useEventStream';
import PaymentsRoute from '@/services/payments/payments.route';
import {
  paymentListKey,
  rememberEvent,
  rememberPayment,
} from '@/services/payments/queries';
import { rememberCounts, statsKey } from '@/services/stats/queries';

export const STREAM_EVENTS = Object.values(PaymentEventType);
const FEED_SIZE = 40;

type Listener = (message: PaymentStreamMessage) => void;

/**
 * One connection to the API's event stream for the whole app. Every message patches the query
 * cache at once (rows, timelines, status counts) and is fanned out to subscribers that animate
 * it (the pipeline, the activity feed, the simulator). Aggregates that need the server (lists,
 * insights) are refetched at most once a second, so a burst does not become a burst of requests.
 */
class LiveHub {
  private listeners = new Set<Listener>();
  private feedListeners = new Set<() => void>();
  feed: PaymentStreamMessage[] = [];
  /** Payment id → when it last changed, for the brief highlight on rows. */
  readonly touched = new Map<string, number>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  subscribeFeed = (listener: () => void) => {
    this.feedListeners.add(listener);
    return () => void this.feedListeners.delete(listener);
  };

  getFeed = () => this.feed;

  publish(message: PaymentStreamMessage) {
    this.touched.set(message.payment.id, Date.now());
    if (!this.feed.some((m) => m.event.sequence === message.event.sequence)) {
      this.feed = [message, ...this.feed].slice(0, FEED_SIZE);
      for (const l of this.feedListeners) l();
    }
    for (const l of this.listeners) l(message);
  }
}

interface LiveContextValue {
  hub: LiveHub;
  state: StreamState;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [hub] = useState(() => new LiveHub());
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(pending.current), []);

  const refreshAggregates = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      void client.invalidateQueries({ queryKey: paymentListKey });
      void client.invalidateQueries({ queryKey: statsKey });
    }, 1000);
  }, [client]);

  const state = useEventStream(PaymentsRoute.stream, STREAM_EVENTS, (_name, data) => {
    const message = data as PaymentStreamMessage;
    rememberPayment(client, message.payment);
    rememberEvent(client, message.event);
    rememberCounts(client, message);
    hub.publish(message);
    refreshAggregates();
  });

  return <LiveContext.Provider value={{ hub, state }}>{children}</LiveContext.Provider>;
}

function useLiveContext(): LiveContextValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive* must be used inside <LiveProvider>');
  return value;
}

export function useStreamState(): StreamState {
  return useLiveContext().state;
}

/** Call `onMessage` for every live event (kept current without resubscribing). */
export function useLiveEvents(onMessage: Listener): void {
  const { hub } = useLiveContext();
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  useEffect(() => hub.subscribe((m) => handler.current(m)), [hub]);
}

/** The most recent live events, newest first. */
export function useLiveFeed(): PaymentStreamMessage[] {
  const { hub } = useLiveContext();
  return useSyncExternalStore(hub.subscribeFeed, hub.getFeed, () => EMPTY);
}
const EMPTY: PaymentStreamMessage[] = [];

/** When a payment last changed live (ms epoch), or undefined: drives row highlights. */
export function useTouchedAt(): (paymentId: string) => number | undefined {
  const { hub } = useLiveContext();
  return useCallback((id: string) => hub.touched.get(id), [hub]);
}
