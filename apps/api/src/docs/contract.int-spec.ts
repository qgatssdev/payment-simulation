import { PaymentStatus } from '@payment-sim/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { Container } from '../container';
import {
  closeIntegrationApps,
  createIntegrationApp,
  createTestDataSource,
} from '../test/database';
import { API_VERSION, buildOpenApiDocument } from './openapi';
import { OpenApiValidator } from '../test/openapi-validator';

/**
 * The documented response schemas are written by hand, so this suite holds them to reality:
 * it drives the real API through every documented outcome and validates each real response
 * body against the schema documented for exactly that method, path and status. A response
 * the docs do not mention fails too, and so does a documented response nobody exercised.
 */
describe('API contract', () => {
  const document = buildOpenApiDocument(API_VERSION);
  const validator = new OpenApiValidator(document);
  const exercised = new Set<string>();

  let dataSource: DataSource;
  let app: Express;
  let container: Container;
  let keySeq = 0;
  const key = () => `contract-${Date.now()}-${++keySeq}`;

  /** Documented responses this suite deliberately does not trigger, and why. */
  const NOT_EXERCISED: Record<string, string> = {
    'POST /api/v1/payments 413': 'body limit; covered in app.spec.ts',
    'POST /api/v1/payments 429': 'rate limiting; covered in app.spec.ts',
    'GET /api/v1/payments 429': 'rate limiting; covered in app.spec.ts',
    'POST /api/v1/payments 503': 'database outage; mapping covered in app.spec.ts',
    'GET /api/v1/payments/{id}/stream 503': 'stream cap; covered in realtime.int-spec.ts',
    'GET /api/v1/stream 503': 'stream cap; covered in realtime.int-spec.ts',
    'GET /ready 503': 'database outage; covered in readiness.int-spec.ts',
  };

  async function conforms(
    pending: request.Test,
    method: string,
    pathTemplate: string,
  ): Promise<request.Response> {
    const res = await pending;
    const label = `${method} ${pathTemplate} ${res.status}`;
    const documented = validator.response(method, pathTemplate, res.status);
    expect({ label, documented: documented !== undefined }).toEqual({
      label,
      documented: true,
    });
    exercised.add(label);

    const schema = documented?.content?.['application/json']?.schema;
    if (schema) {
      expect({ label, errors: validator.validate(schema, res.body) }).toEqual({
        label,
        errors: [],
      });
    }
    return res;
  }

  const newPayment = (card = '4242424242424242', overrides: object = {}) => ({
    amount: 125_000,
    currency: 'NGN',
    customerEmail: 'ada@example.com',
    description: 'contract',
    card: { number: card, expMonth: 12, expYear: 2030, cvc: '123' },
    ...overrides,
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const started = await container.worker.tick();
      await container.worker.drain();
      if (started === 0) return;
    }
  }

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    ({ app, container } = await createIntegrationApp(
      dataSource,
      {},
      {
        GATEWAY_MIN_LATENCY_MS: '0',
        GATEWAY_MAX_LATENCY_MS: '0',
        RETRY_BASE_DELAY_MS: '0',
        RETRY_MAX_DELAY_MS: '0',
      },
    ));
  });

  afterAll(async () => {
    await closeIntegrationApps();
    await dataSource.destroy();
  });

  it('payments: create, replay, read, list, timeline, change status', async () => {
    const idempotencyKey = key();
    const post = (body: object, k = idempotencyKey) =>
      conforms(
        request(app).post('/api/v1/payments').set('Idempotency-Key', k).send(body),
        'POST',
        '/api/v1/payments',
      );

    const created = await post(newPayment());
    await post(newPayment()); // replay
    await post(newPayment('4242424242424242', { amount: 1 })); // 422: key reused
    await post({ amount: 'lots' }, key()); // 400
    await conforms(
      request(app).post('/api/v1/payments').send(newPayment()),
      'POST',
      '/api/v1/payments',
    ); // 400: no key

    const declined = await post(newPayment('4000000000000002'), key());
    await settle(); // one SUCCEEDED, one FAILED with failure details

    const id = created.body.data.id as string;
    const get = (path: string) =>
      conforms(
        request(app).get(`/api/v1/payments/${path}`),
        'GET',
        '/api/v1/payments/{id}',
      );
    const succeeded = await get(id);
    expect(succeeded.body.data.status).toBe(PaymentStatus.SUCCEEDED);
    const failed = await get(declined.body.data.id as string);
    expect(failed.body.data.failureCode).toBe('card_declined');
    await conforms(
      request(app)
        .get(`/api/v1/payments/${id}`)
        .set('If-None-Match', succeeded.headers.etag as string),
      'GET',
      '/api/v1/payments/{id}',
    ); // 304
    await get('6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70'); // 404
    await get('nope'); // 400

    const list = (query: object) =>
      conforms(
        request(app).get('/api/v1/payments').query(query),
        'GET',
        '/api/v1/payments',
      );
    await list({ limit: 1 });
    await list({ cursor: 'bad' });

    const events = (path: string) =>
      conforms(
        request(app).get(`/api/v1/payments/${path}/events`),
        'GET',
        '/api/v1/payments/{id}/events',
      );
    await events(id);
    await events('6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70');
    await events('nope');

    const patch = (path: string, body: object, ifMatch?: string) => {
      const req = request(app).patch(`/api/v1/payments/${path}/status`).send(body);
      return conforms(
        ifMatch ? req.set('If-Match', ifMatch) : req,
        'PATCH',
        '/api/v1/payments/{id}/status',
      );
    };
    await patch(id, { status: 'REFUNDED' }, '"1"'); // 412: stale version
    await patch(id, { status: 'REFUNDED', reason: 'returned' }); // 200
    await patch(id, { status: 'REFUNDED' }); // 409
    await patch(id, { status: 'SUCCEEDED' }); // 400
    await patch('6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70', { status: 'CANCELLED' }); // 404
  });

  it('stats and probes', async () => {
    await conforms(request(app).get('/api/v1/stats'), 'GET', '/api/v1/stats');
    await conforms(request(app).get('/health'), 'GET', '/health');
    await conforms(request(app).get('/ready'), 'GET', '/ready');
  });

  it('streams: JSON errors before the stream starts', async () => {
    await conforms(
      request(app).get('/api/v1/payments/6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70/stream'),
      'GET',
      '/api/v1/payments/{id}/stream',
    );
    await conforms(
      request(app).get('/api/v1/payments/nope/stream'),
      'GET',
      '/api/v1/payments/{id}/stream',
    );
    await conforms(
      request(app).get('/api/v1/stream?lastEventId=-1'),
      'GET',
      '/api/v1/stream',
    );
  });

  it('every documented JSON response was exercised (or is knowingly excluded)', () => {
    const missing = validator
      .documentedJsonResponses()
      .filter((label) => !exercised.has(label) && !(label in NOT_EXERCISED));
    expect(missing).toEqual([]);

    // Keep the exclusion list honest: nothing in it that the docs no longer promise.
    const documented = new Set(validator.documentedJsonResponses());
    expect(Object.keys(NOT_EXERCISED).filter((label) => !documented.has(label))).toEqual(
      [],
    );
  });
});
