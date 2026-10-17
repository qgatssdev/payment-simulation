import type {
  ApiPage,
  ApiSuccess,
  PaymentEventView,
  PaymentRequestView,
  PaymentView,
} from '@payment-sim/shared';
import { HEADERS } from '@payment-sim/shared';
import apiHandler from '../api';
import PaymentsRoute from './payments.route';
import type { CreatePaymentPayload, PaymentsParams, UpdateStatusPayload } from './types';

// The list keeps its pagination, so it returns the whole envelope.
export const getPayments = async (params: PaymentsParams) => {
  const response = await apiHandler.get<ApiPage<PaymentView>>(
    PaymentsRoute.getPayments(params),
  );
  return response.data;
};

export const getPayment = async (id: string) => {
  const response = await apiHandler.get<ApiSuccess<PaymentView>>(
    PaymentsRoute.getPayment(id),
  );
  return response.data.data;
};

export const getPaymentEvents = async (id: string) => {
  const response = await apiHandler.get<ApiSuccess<PaymentEventView[]>>(
    PaymentsRoute.getPaymentEvents(id),
  );
  return response.data.data;
};

export const getPaymentRequest = async (id: string) => {
  const response = await apiHandler.get<ApiSuccess<PaymentRequestView>>(
    PaymentsRoute.getPaymentRequest(id),
  );
  return response.data.data;
};

/** `replayed` is true when the API answered from the response stored for this key. */
export const createPayment = async (
  payload: CreatePaymentPayload,
  idempotencyKey: string,
) => {
  const response = await apiHandler.post<ApiSuccess<PaymentView>>(
    PaymentsRoute.createPayment,
    payload,
    { [HEADERS.IDEMPOTENCY_KEY]: idempotencyKey },
  );
  return {
    payment: response.data.data,
    replayed: response.headers.get(HEADERS.IDEMPOTENT_REPLAYED) === 'true',
  };
};

/** Conditional on `version` (If-Match): a payment changed since it was read is a 412. */
export const updatePaymentStatus = async (
  id: string,
  payload: UpdateStatusPayload,
  version: number,
) => {
  const response = await apiHandler.patch<ApiSuccess<PaymentView>>(
    PaymentsRoute.updatePaymentStatus(id),
    payload,
    { [HEADERS.IF_MATCH]: `"${version}"` },
  );
  return response.data.data;
};
