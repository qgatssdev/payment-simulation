import { buildQueryParams } from '@/utils/queryParams';
import { baseUrl } from '../index.route';
import type { PaymentsParams } from './types';

const PaymentsRoute = {
  getPayments: (params: PaymentsParams) =>
    `${baseUrl}/payments${buildQueryParams(params)}`,
  getPayment: (id: string) => `${baseUrl}/payments/${id}`,
  getPaymentEvents: (id: string) => `${baseUrl}/payments/${id}/events`,
  getPaymentRequest: (id: string) => `${baseUrl}/payments/${id}/request`,
  createPayment: `${baseUrl}/payments`,
  updatePaymentStatus: (id: string) => `${baseUrl}/payments/${id}/status`,
  // Server-Sent Events: every payment, or one payment (which starts with a snapshot).
  stream: `${baseUrl}/stream`,
  paymentStream: (id: string) => `${baseUrl}/payments/${id}/stream`,
};

export default PaymentsRoute;
