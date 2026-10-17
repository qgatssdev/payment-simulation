import type { InsightsRange } from '@payment-sim/shared';
import { buildQueryParams } from '@/utils/queryParams';
import { baseUrl } from '../index.route';

const StatsRoute = {
  getStats: `${baseUrl}/stats`,
  getInsights: (range: InsightsRange) =>
    `${baseUrl}/stats/insights${buildQueryParams({ range })}`,
};

export default StatsRoute;
