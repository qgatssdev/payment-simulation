import type { InsightsRange, PaymentStreamMessage, StatsView } from '@payment-sim/shared';
import { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { getInsights, getStats } from '.';

// Stats and insights share the "stats" root, so invalidating ["stats"] refreshes both.
export const statsKey = ['stats'];
export const insightsKey = (range: InsightsRange) => [...statsKey, 'insights', range];

export const useStats = () => {
  return useQuery({ queryKey: statsKey, queryFn: getStats });
};

export const useInsights = (range: InsightsRange) => {
  return useQuery({
    queryKey: insightsKey(range),
    queryFn: () => getInsights(range),
    // Buckets roll over with time even when nothing happens.
    refetchInterval: range === '15m' ? 15_000 : 30_000,
    placeholderData: (previous) => previous,
  });
};

/**
 * Apply a live event to the cached status counts at once, so the pipeline and headline
 * numbers move with the stream; the throttled refetch then reconciles with the server.
 */
export const rememberCounts = (client: QueryClient, message: PaymentStreamMessage) => {
  const { event } = message;
  client.setQueryData<StatsView>(statsKey, (stats) => {
    if (!stats) return stats;
    const counts = { ...stats.countsByStatus };
    let total = stats.total;
    if (event.type === PaymentEventType.CREATED) {
      counts[PaymentStatus.PENDING] += 1;
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
};
