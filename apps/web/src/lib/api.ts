import type {
  ApiErrorBody,
  ApiPage,
  ApiSuccess,
  Currency,
  ErrorCode,
  InsightsRange,
  InsightsView,
  PaymentEventView,
  PaymentRequestView,
  PaymentStatus,
  PaymentView,
  StatsView,
} from '@payment-sim/shared';
import { HEADERS } from '@payment-sim/shared';
import { API_URL } from './config';

/** Everything the UI needs to explain a failure: what, which code, and which request. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    readonly requestId?: string,
    readonly details?: ApiErrorBody['error']['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Worth retrying with the same idempotency key: the server may or may not have acted. */
  get retryable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.status >= 500;
  }
}

export interface CreatePaymentBody {
  amount: number;
  currency: Currency;
  customerEmail: string;
  description?: string;
  card: {
    number: string;
    expMonth: number;
    expYear: number;
    cvc: string;
    holderName?: string;
  };
}

export interface ListQuery {
  cursor?: string;
  status?: PaymentStatus;
  currency?: Currency;
  q?: string;
  limit?: number;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ body: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(`Could not reach the API at ${API_URL}`, 0, 'NETWORK_ERROR');
  }

  if (!res.ok) {
    const error = (await res.json().catch(() => undefined)) as ApiErrorBody | undefined;
    throw new ApiError(
      error?.message ?? `Request failed with status ${res.status}`,
      res.status,
      error?.error.code ?? ('INTERNAL_ERROR' as ErrorCode),
      error?.requestId ?? res.headers.get(HEADERS.REQUEST_ID) ?? undefined,
      error?.error.details,
    );
  }
  return { body: (await res.json()) as T, headers: res.headers };
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...headers },
});

export const api = {
  async listPayments(query: ListQuery = {}): Promise<ApiPage<PaymentView>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return (await request<ApiPage<PaymentView>>(`/api/v1/payments${qs ? `?${qs}` : ''}`))
      .body;
  },

  async getPayment(id: string): Promise<PaymentView> {
    return (await request<ApiSuccess<PaymentView>>(`/api/v1/payments/${id}`)).body.data;
  },

  async getEvents(id: string): Promise<PaymentEventView[]> {
    return (
      await request<ApiSuccess<PaymentEventView[]>>(`/api/v1/payments/${id}/events`)
    ).body.data;
  },

  async getStats(): Promise<StatsView> {
    return (await request<ApiSuccess<StatsView>>('/api/v1/stats')).body.data;
  },

  async getInsights(range: InsightsRange): Promise<InsightsView> {
    return (
      await request<ApiSuccess<InsightsView>>(`/api/v1/stats/insights?range=${range}`)
    ).body.data;
  },

  async getPaymentRequest(id: string): Promise<PaymentRequestView> {
    return (
      await request<ApiSuccess<PaymentRequestView>>(`/api/v1/payments/${id}/request`)
    ).body.data;
  },

  async createPayment(
    body: CreatePaymentBody,
    idempotencyKey: string,
  ): Promise<{ payment: PaymentView; replayed: boolean }> {
    const res = await request<ApiSuccess<PaymentView>>('/api/v1/payments', {
      method: 'POST',
      ...json(body, { [HEADERS.IDEMPOTENCY_KEY]: idempotencyKey }),
    });
    return {
      payment: res.body.data,
      replayed: res.headers.get(HEADERS.IDEMPOTENT_REPLAYED) === 'true',
    };
  },

  /** Conditional on `version` (If-Match): a payment changed since it was read is a 412. */
  async updateStatus(
    id: string,
    change: { status: PaymentStatus; reason?: string },
    version: number,
  ): Promise<PaymentView> {
    const res = await request<ApiSuccess<PaymentView>>(`/api/v1/payments/${id}/status`, {
      method: 'PATCH',
      ...json(change, { [HEADERS.IF_MATCH]: `"${version}"` }),
    });
    return res.body.data;
  },
};
