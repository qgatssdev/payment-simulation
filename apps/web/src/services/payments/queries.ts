import type { ApiPage, PaymentEventView, PaymentView } from '@payment-sim/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getPayment, getPaymentEvents, getPaymentRequest, getPayments } from '.';
import type { PaymentsParams } from './types';

// Everything payment-shaped shares the "payments" root.
export const paymentsKey = ['payments'];
export const paymentListKey = [...paymentsKey, 'list'];
export const paymentKey = (id: string) => [...paymentsKey, 'detail', id];
export const paymentEventsKey = (id: string) => [...paymentsKey, 'events', id];
export const paymentRequestKey = (id: string) => [...paymentsKey, 'request', id];

/** The payments list, one page per cursor, loaded as the table scrolls. */
export const usePayments = (params: Omit<PaymentsParams, 'cursor'>) => {
  return useInfiniteQuery({
    queryKey: [...paymentListKey, params],
    queryFn: ({ pageParam }) => getPayments({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
  });
};

// The ⌘K palette's search: a single short page, only once there is something to search.
export const usePaymentSearch = (q: string, enabled: boolean) => {
  return useQuery({
    queryKey: [...paymentListKey, { q, limit: 6, palette: true }],
    queryFn: () => getPayments({ q, limit: 6 }),
    enabled,
    staleTime: 5_000,
  });
};

export const usePayment = (id: string) => {
  return useQuery({ queryKey: paymentKey(id), queryFn: () => getPayment(id) });
};

export const usePaymentEvents = (id: string) => {
  return useQuery({
    queryKey: paymentEventsKey(id),
    queryFn: () => getPaymentEvents(id),
  });
};

export const usePaymentRequest = (id: string) => {
  return useQuery({
    queryKey: paymentRequestKey(id),
    queryFn: () => getPaymentRequest(id),
  });
};

/** Never let an older copy overwrite a newer one: versions only go up. */
const newer = (next: PaymentView, current: PaymentView | undefined) =>
  current && current.version > next.version ? current : next;

/** Write a payment from the live stream into its detail query and every list holding it. */
export const rememberPayment = (client: QueryClient, payment: PaymentView) => {
  client.setQueryData<PaymentView>(paymentKey(payment.id), (current) =>
    newer(payment, current),
  );
  client.setQueriesData<InfiniteData<ApiPage<PaymentView>>>(
    { queryKey: paymentListKey },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: page.data.map((p) => (p.id === payment.id ? newer(payment, p) : p)),
        })),
      },
  );
};

export const rememberEvent = (client: QueryClient, event: PaymentEventView) => {
  client.setQueryData<PaymentEventView[]>(paymentEventsKey(event.paymentId), (events) => {
    if (!events) return events;
    if (events.some((e) => e.sequence === event.sequence)) return events;
    return [...events, event].sort((a, b) => a.sequence - b.sequence);
  });
};
