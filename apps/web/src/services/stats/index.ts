import type {
  ApiSuccess,
  InsightsRange,
  InsightsView,
  StatsView,
} from '@payment-sim/shared';
import apiHandler from '../api';
import StatsRoute from './stats.route';

export const getStats = async () => {
  const response = await apiHandler.get<ApiSuccess<StatsView>>(StatsRoute.getStats);
  return response.data.data;
};

export const getInsights = async (range: InsightsRange) => {
  const response = await apiHandler.get<ApiSuccess<InsightsView>>(
    StatsRoute.getInsights(range),
  );
  return response.data.data;
};
