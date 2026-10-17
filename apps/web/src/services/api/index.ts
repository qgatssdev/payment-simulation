import type { ApiErrorBody, ErrorCode } from '@payment-sim/shared';
import { HEADERS } from '@payment-sim/shared';
import { API_URL } from '@/config';

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

export interface ApiResponse<T> {
  data: T;
  headers: Headers;
}

type RequestHeaders = Record<string, string>;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: RequestHeaders = {},
): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      // Content-Type only on requests with a body: on a GET it would make the browser send
      // a CORS preflight first.
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  return { data: (await res.json()) as T, headers: res.headers };
}

/** The one HTTP client the services use. Shaped like axios: the body is `response.data`. */
const apiHandler = {
  get: <T>(path: string, headers?: RequestHeaders) =>
    request<T>('GET', path, undefined, headers),
  post: <T>(path: string, body: unknown, headers?: RequestHeaders) =>
    request<T>('POST', path, body, headers),
  patch: <T>(path: string, body: unknown, headers?: RequestHeaders) =>
    request<T>('PATCH', path, body, headers),
};

export default apiHandler;
