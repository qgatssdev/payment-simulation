import type {
  ApiPage,
  PaymentEventView,
  PaymentStatus,
  PaymentView,
} from '@payment-sim/shared';
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
