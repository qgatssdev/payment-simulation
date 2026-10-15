import { ApiError, api } from './api';

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the idempotency key and reports a replay', async () => {
    const fetchMock = respond(
      202,
      { success: true, message: 'ok', data: { id: 'p1' } },
      { 'Idempotent-Replayed': 'true' },
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.createPayment(
      {
        amount: 1,
        currency: 'USD',
        customerEmail: 'a@b.co',
        card: { number: '4242424242424242', expMonth: 1, expYear: 2030, cvc: '123' },
      },
      'key-1',
    );
    expect(result).toEqual({ payment: { id: 'p1' }, replayed: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/v1/payments');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'key-1' });
  });

  it('sends the version as If-Match on status changes', async () => {
    const fetchMock = respond(200, { success: true, message: 'ok', data: { id: 'p1' } });
    vi.stubGlobal('fetch', fetchMock);
    await api.updateStatus('p1', { status: 'CANCELLED' as never }, 3);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'If-Match': '"3"' });
  });

  it('turns the API error envelope into an ApiError with code and request id', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        success: false,
        message: 'Cannot move a FAILED payment to REFUNDED',
        error: { code: 'INVALID_STATE_TRANSITION', details: { from: 'FAILED' } },
        requestId: 'req-9',
      }),
    );
    const error = await api.getPayment('p1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      requestId: 'req-9',
      retryable: false,
    });
  });

  it('reports an unreachable API as a retryable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = (await api.getStats().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('builds list queries without empty filters', async () => {
    const fetchMock = respond(200, {
      success: true,
      message: 'ok',
      data: [],
      pagination: {},
    });
    vi.stubGlobal('fetch', fetchMock);
    await api.listPayments({ status: 'FAILED' as never, cursor: undefined, limit: 10 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:4000/api/v1/payments?status=FAILED&limit=10',
    );
  });
});
