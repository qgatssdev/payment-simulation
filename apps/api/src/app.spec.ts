import { ErrorCode, HEADERS } from '@payment-sim/shared';
import { IsInt, IsString, Min } from 'class-validator';
import request from 'supertest';
import { endpoint } from './libs/common/http/endpoint';
import { BaseResponse } from './libs/core/base/base.response';
import { ConflictError } from './libs/core/errors';
import { requestContext } from './libs/core/logger/request-context';
import { buildTestApp, captureLogger } from './test/helpers';

class EchoBody {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class EchoParams {
  @IsString()
  id!: string;
}

const UUID = /^[0-9a-f-]{36}$/;

function appWithRoutes(options: Parameters<typeof buildTestApp>[0] = {}) {
  return buildTestApp({
    ...options,
    routes: (router) => {
      router.post(
        '/echo/:id',
        endpoint(
          { body: EchoBody, params: EchoParams },
          ({ body, params }, _req, res) => {
            res.status(201).json(
              BaseResponse.success({
                ...body,
                id: params.id,
                isInstance: body instanceof EchoBody,
                // Proves the async context survived body parsing and the await in endpoint().
                contextRequestId: requestContext.requestId(),
              }),
            );
          },
        ),
      );
      router.get('/conflict', () => {
        throw new ConflictError('already done', ErrorCode.INVALID_STATE_TRANSITION, {
          from: 'FAILED',
        });
      });
      router.get('/boom', () => {
        throw new Error('db password is hunter2');
      });
      router.get('/async-boom', async () => {
        await Promise.resolve();
        throw Object.assign(new Error('connection terminated'), { code: '08006' });
      });
      router.get('/ok', (_req, res) => {
        res.json(BaseResponse.success({ ok: true }));
      });
    },
  });
}

describe('request ids', () => {
  const app = appWithRoutes();

  it('generates one and echoes it in the header and error bodies', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('honours a well-formed incoming id', async () => {
    const res = await request(app)
      .get('/api/v1/ok')
      .set(HEADERS.REQUEST_ID, 'trace-abc_123');
    expect(res.headers['x-request-id']).toBe('trace-abc_123');
  });

  it.each(['has spaces', 'x'.repeat(129), '<script>'])(
    'replaces an unsafe id %p',
    async (id) => {
      const res = await request(app).get('/api/v1/ok').set(HEADERS.REQUEST_ID, id);
      expect(res.headers['x-request-id']).toMatch(UUID);
    },
  );

  it('keeps the request context through body parsing into the handler', async () => {
    const res = await request(app)
      .post('/api/v1/echo/42')
      .set(HEADERS.REQUEST_ID, 'ctx-check')
      .send({ name: 'widget', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.data.contextRequestId).toBe('ctx-check');
  });
});

describe('endpoint validation', () => {
  const app = appWithRoutes();

  it('hands the handler validated DTO instances', async () => {
    const res = await request(app)
      .post('/api/v1/echo/42')
      .send({ name: 'widget', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      message: 'Success',
      data: expect.objectContaining({
        name: 'widget',
        quantity: 2,
        id: '42',
        isInstance: true,
      }) as unknown,
    });
  });

  it('reports every issue with its location in one 400', async () => {
    const res = await request(app)
      .post('/api/v1/echo/42')
      .send({ name: 5, quantity: 0, extra: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: 'Request validation failed',
      error: { code: ErrorCode.VALIDATION_ERROR },
    });
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: 'body', field: 'name' }),
        expect.objectContaining({ location: 'body', field: 'quantity' }),
        expect.objectContaining({ location: 'body', field: 'extra' }),
      ]),
    );
  });

  it('treats a missing JSON body as empty and lists the required fields', async () => {
    const res = await request(app)
      .post('/api/v1/echo/42')
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'name',
      'quantity',
    ]);
  });

  it('rejects a JSON array body', async () => {
    const res = await request(app).post('/api/v1/echo/42').send([1, 2]);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { location: 'body', field: '', messages: ['body must be a JSON object'] },
    ]);
  });
});

describe('error handling', () => {
  it('turns malformed JSON into a 400, not a 500', async () => {
    const res = await request(appWithRoutes())
      .post('/api/v1/echo/42')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Malformed JSON body',
      error: { code: ErrorCode.VALIDATION_ERROR },
    });
  });

  it('rejects bodies over the configured limit with 413', async () => {
    const res = await request(appWithRoutes({ env: { BODY_LIMIT: '100b' } }))
      .post('/api/v1/echo/42')
      .send({ name: 'x'.repeat(200), quantity: 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
  });

  it('serialises AppErrors with their status, code and details', async () => {
    const res = await request(appWithRoutes()).get('/api/v1/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: 'already done',
      error: { code: ErrorCode.INVALID_STATE_TRANSITION, details: { from: 'FAILED' } },
      requestId: res.headers['x-request-id'],
    });
  });

  it('hides unexpected errors behind a generic 500 but logs them', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(appWithRoutes({ logger })).get('/api/v1/boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');

    const failure = lines().find((l) => l.msg === 'request failed');
    expect(failure).toMatchObject({
      level: 'error',
      code: ErrorCode.INTERNAL_ERROR,
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(failure)).toContain('hunter2');
  });

  it('maps transient database failures from async handlers to 503 with Retry-After', async () => {
    const res = await request(appWithRoutes()).get('/api/v1/async-boom');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.body.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await request(appWithRoutes()).delete('/api/v1/payments');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      message: 'Route DELETE /api/v1/payments not found',
      error: { code: ErrorCode.NOT_FOUND },
    });
  });
});

describe('access logging', () => {
  it('writes one line per request with status, duration and request id', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(appWithRoutes({ logger }))
      .post('/api/v1/echo/1')
      .send({ name: 'n', quantity: 0 });
    // The close event can land just after supertest resolves.
    await new Promise((resolve) => setImmediate(resolve));

    const access = lines().filter((l) => l.msg === 'request completed');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      level: 'warn',
      method: 'POST',
      url: '/api/v1/echo/1',
      status: 400,
      requestId: res.headers['x-request-id'],
    });
    expect(typeof access[0]?.durationMs).toBe('number');
  });
});

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const check = { name: 'database', check: jest.fn() };
    const res = await request(buildTestApp({ checks: [check] })).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', version: 'test' });
    expect(check.check).not.toHaveBeenCalled();
  });

  it('is ready when every check passes', async () => {
    const res = await request(
      buildTestApp({ checks: [{ name: 'database', check: () => Promise.resolve() }] }),
    ).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ready: true,
      checks: { database: { status: 'up' } },
    });
  });

  it('is not ready when a check fails or hangs, without leaking why', async () => {
    const res = await request(
      buildTestApp({
        checks: [
          {
            name: 'database',
            check: () => Promise.reject(new Error('password authentication failed')),
          },
          { name: 'listener', check: () => new Promise(() => {}) },
        ],
      }),
    ).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      data: {
        ready: false,
        checks: { database: { status: 'down' }, listener: { status: 'down' } },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('http hardening', () => {
  const app = appWithRoutes({
    env: { CORS_ORIGINS: 'https://pay.example.com', RATE_LIMIT_MAX: '2' },
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows configured origins and exposes the correlation headers', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://pay.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://pay.example.com');
    expect(res.headers['access-control-expose-headers']).toContain(HEADERS.REQUEST_ID);
  });

  it('does not grant other origins', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits the API with the standard error envelope but never the probes', async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await request(app).get('/api/v1/ok')).status);
    expect(statuses).toEqual([200, 200, 429]);

    const limited = await request(app).get('/api/v1/ok');
    expect(limited.body.error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(limited.headers['ratelimit-policy']).toBeDefined();

    expect((await request(app).get('/health')).status).toBe(200);
  });
});
