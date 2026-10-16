import type {
  ApiPage,
  InsightsRange,
  PaymentEventView,
  PaymentStatus,
  PaymentStreamMessage,
  PaymentView,
  StatsView,
} from '@payment-sim/shared';
import { PaymentEventType, PaymentStatus as Status } from '@payment-sim/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ListQuery } from './api';
import { api } from './api';

export const queryKeys = {
  payments: ['payments'] as const,
  list: (filters: Omit<ListQuery, 'cursor'>) => ['payments', 'list', filters] as const,
  payment: (id: string) => ['payments', 'detail', id] as const,
  events: (id: string) => ['payments', 'events', id] as const,
  stats: ['stats'] as const,
  insights: (range: InsightsRange) => ['stats', 'insights', range] as const,
  request: (id: string) => ['payments', 'request', id] as const,
};

export function usePaymentList(filters: Omit<ListQuery, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: queryKeys.list(filters),
    queryFn: ({ pageParam }) => api.listPayments({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
  });
}

export function usePayment(id: string) {
  return useQuery({ queryKey: queryKeys.payment(id), queryFn: () => api.getPayment(id) });
}

export function usePaymentEvents(id: string) {
  return useQuery({ queryKey: queryKeys.events(id), queryFn: () => api.getEvents(id) });
}

export function useStats() {
  return useQuery({ queryKey: queryKeys.stats, queryFn: () => api.getStats() });
}

export function useInsights(range: InsightsRange) {
  return useQuery({
    queryKey: queryKeys.insights(range),
    queryFn: () => api.getInsights(range),
    // Buckets roll over with time even when nothing happens.
    refetchInterval: range === '15m' ? 15_000 : 30_000,
    placeholderData: (previous) => previous,
  });
}

export function usePaymentRequest(id: string) {
  return useQuery({
    queryKey: queryKeys.request(id),
    queryFn: () => api.getPaymentRequest(id),
  });
}

/**
 * Apply a live event to the cached status counts at once, so the pipeline and headline
 * numbers move with the stream; the throttled refetch then reconciles with the server.
 */
export function rememberCounts(client: QueryClient, message: PaymentStreamMessage): void {
  const { event } = message;
  client.setQueryData<StatsView>(queryKeys.stats, (stats) => {
    if (!stats) return stats;
    const counts = { ...stats.countsByStatus };
    let total = stats.total;
    if (event.type === PaymentEventType.CREATED) {
      counts[Status.PENDING] += 1;
      total += 1;
    } else if (event.type === PaymentEventType.STATUS_CHANGED) {
      if (event.fromStatus)
        counts[event.fromStatus] = Math.max(0, counts[event.fromStatus] - 1);
      if (event.toStatus) counts[event.toStatus] += 1;
    } else {
      return stats;
    }
    return { ...stats, countsByStatus: counts, total };
  });
}

/** Never let an older copy overwrite a newer one: versions only go up. */
function newer(next: PaymentView, current: PaymentView | undefined): PaymentView {
  return current && current.version > next.version ? current : next;
}

export function rememberPayment(client: QueryClient, payment: PaymentView): void {
  client.setQueryData<PaymentView>(queryKeys.payment(payment.id), (current) =>
    newer(payment, current),
  );
  client.setQueriesData<InfiniteData<ApiPage<PaymentView>>>(
    { queryKey: [...queryKeys.payments, 'list'] },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: page.data.map((p) => (p.id === payment.id ? newer(payment, p) : p)),
        })),
      },
  );
}

export function rememberEvent(client: QueryClient, event: PaymentEventView): void {
  client.setQueryData<PaymentEventView[]>(queryKeys.events(event.paymentId), (events) => {
    if (!events) return events;
    if (events.some((e) => e.sequence === event.sequence)) return events;
    return [...events, event].sort((a, b) => a.sequence - b.sequence);
  });
}

/**
 * Cancel or refund, conditional on the version shown. The UI updates at once and rolls back
 * if the API refuses (illegal transition, someone else changed it first, network).
 */
export function useUpdateStatus(payment: PaymentView) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: { status: PaymentStatus; reason?: string }) =>
      api.updateStatus(payment.id, change, payment.version),
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: queryKeys.payment(payment.id) });
      const previous = client.getQueryData<PaymentView>(queryKeys.payment(payment.id));
      client.setQueryData<PaymentView>(queryKeys.payment(payment.id), (current) =>
        current ? { ...current, status: change.status } : current,
      );
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous)
        client.setQueryData(queryKeys.payment(payment.id), context.previous);
      void client.invalidateQueries({ queryKey: queryKeys.payment(payment.id) });
    },
    onSuccess: (updated) => {
      rememberPayment(client, updated);
      void client.invalidateQueries({ queryKey: queryKeys.events(payment.id) });
      void client.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}
