import { ErrorCode, PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { Express } from 'express';
import request from 'supertest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaymentCollections, PaymentStore } from '../../infra/store/payment-store';
import {
  closeTestApps,
  createTestApp,
  createTestStore,
  patchRecord,
} from '../../test/app';
import { JobStatus } from '../processing/entity/job.entity';

const nextYear = new Date().getUTCFullYear() + 1;

const paymentBody = (overrides: Record<string, unknown> = {}) => ({
  amount: 250_000,
  currency: 'NGN',
  customerEmail: 'ada@example.com',
  description: 'Order #1001',
  card: { number: '4242 4242 4242 4242', expMonth: 12, expYear: nextYear, cvc: '123' },
  ...overrides,
});

describe('payments API', () => {
  let store: PaymentStore;
  let app: Express;
  let keySeq = 0;
  const freshKey = () => `test-key-${Date.now()}-${++keySeq}`;

  const createPayment = (body = paymentBody(), key = freshKey()) =>
    request(app).post('/api/v1/payments').set('Idempotency-Key', key).send(body);

  const count = (collection: keyof PaymentCollections) => store.count(collection);
  const eventsOf = (paymentId: string) =>
    store
      .find('paymentEvents', (e) => e.paymentId === paymentId)
      .sort((a, b) => a.sequence - b.sequence);

  /** Move a payment along the system path directly, as the worker would. */
  const forceStatus = (id: string, status: PaymentStatus) =>
    patchRecord(store, 'payments', id, { status });

  beforeEach(async () => {
    store = await createTestStore();
    ({ app } = await createTestApp(store));
  });

  afterEach(() => closeTestApps());

  describe('POST /payments', () => {
    it('accepts a payment for async processing', async () => {
      const res = await createPayment();

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Payment accepted for processing',
        data: {
          amount: 250_000,
          currency: 'NGN',
          status: PaymentStatus.PENDING,
          customerEmail: 'ada@example.com',
          description: 'Order #1001',
          paymentMethod: {
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: nextYear,
          },
          failureCode: null,
          attempts: 0,
          version: 1,
          processedAt: null,
        },
      });
      const { id } = res.body.data;
      expect(res.headers.location).toBe(`/api/v1/payments/${id}`);
      expect(res.headers.etag).toBe('"1"');
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    });

    it('never stores or returns the card number or CVC', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'payments-'));
      const file = join(dir, 'data.json');
      const fileStore = await createTestStore({ file });
      try {
        const { app: fileApp } = await createTestApp(fileStore);
        const res = await request(fileApp)
          .post('/api/v1/payments')
          .set('Idempotency-Key', freshKey())
          .send(paymentBody());
        expect(res.status).toBe(202);
        expect(JSON.stringify(res.body)).not.toMatch(/4242424242424242|"cvc"/);

        // The data file is what persists: it holds the token and last4, never the PAN or CVC.
        const contents = await readFile(file, 'utf8');
        expect(contents).toContain('"last4": "4242"');
        expect(contents).toContain('"token": "tok_sim_succeed_');
        expect(contents).not.toMatch(/4242424242424242|"cvc"|"123"/);
      } finally {
        await closeTestApps();
        await fileStore.close();
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('records the created event and enqueues exactly one processing job, atomically', async () => {
      const { body } = await createPayment();
      const events = eventsOf(body.data.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: PaymentEventType.CREATED,
        toStatus: PaymentStatus.PENDING,
        metadata: { amount: 250_000, currency: 'NGN' },
      });

      const jobs = store.find('jobs', (j) => j.paymentId === body.data.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.status).toBe(JobStatus.QUEUED);
    });

    it('requires an Idempotency-Key and stores nothing without one', async () => {
      const res = await request(app).post('/api/v1/payments').send(paymentBody());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
      expect(count('payments')).toBe(0);
    });

    it('rejects a malformed Idempotency-Key', async () => {
      const res = await createPayment(paymentBody(), 'has spaces in it');
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ location: 'headers', field: 'Idempotency-Key' }),
      ]);
    });

    it('validates the body before touching the database', async () => {
      const res = await createPayment(
        paymentBody({ amount: -5, card: { number: '4242424242424241' } }),
      );
      expect(res.status).toBe(400);
      const fields = res.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining(['amount', 'card.number', 'card.cvc']),
      );
      expect(count('payments')).toBe(0);
      expect(count('idempotencyKeys')).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('replays the original response for a repeated key and creates nothing new', async () => {
      const key = freshKey();
      const first = await createPayment(paymentBody(), key);
      // Same request, formatted differently: spacing, case and key order do not matter.
      const second = await createPayment(
        {
          customerEmail: 'ADA@example.com ',
          card: {
            cvc: '123',
            expYear: nextYear,
            expMonth: 12,
            number: '4242424242424242',
          },
          currency: 'ngn',
          amount: 250_000,
          description: 'Order #1001',
        },
        key,
      );

      expect(second.status).toBe(202);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(count('payments')).toBe(1);
      expect(count('jobs')).toBe(1);
    });

    it('rejects the same key reused for a different request', async () => {
      const key = freshKey();
      await createPayment(paymentBody(), key);
      const res = await createPayment(paymentBody({ amount: 999 }), key);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REUSED);
      expect(count('payments')).toBe(1);
    });

    it('creates exactly one payment when duplicates race', async () => {
      const key = freshKey();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => createPayment(paymentBody(), key)),
      );

      expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202));
      expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
      expect(responses.filter((r) => r.headers['idempotent-replayed']).length).toBe(7);
      expect(count('payments')).toBe(1);
      expect(count('jobs')).toBe(1);
    });

    it('lets an expired key be used again', async () => {
      const key = freshKey();
      const first = await createPayment(paymentBody(), key);
      await patchRecord(store, 'idempotencyKeys', key, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const second = await createPayment(paymentBody(), key);
      expect(second.status).toBe(202);
      expect(second.headers['idempotent-replayed']).toBeUndefined();
      expect(second.body.data.id).not.toBe(first.body.data.id);
    });
  });

  describe('GET /payments/:id', () => {
    it('returns the payment with its version as ETag', async () => {
      const created = await createPayment();
      const res = await request(app).get(`/api/v1/payments/${created.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(created.body.data);
      expect(res.headers.etag).toBe('"1"');
    });

    it('answers 304 when the client already has this version', async () => {
      const created = await createPayment();
      const res = await request(app)
        .get(`/api/v1/payments/${created.body.data.id}`)
        .set('If-None-Match', '"1"');
      expect(res.status).toBe(304);
    });

    it('404s for an unknown id and 400s for a malformed one', async () => {
      const missing = await request(app).get(
        '/api/v1/payments/6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70',
      );
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe(ErrorCode.NOT_FOUND);

      const malformed = await request(app).get('/api/v1/payments/not-a-uuid');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.details[0]).toMatchObject({
        location: 'params',
        field: 'id',
      });
    });
  });

  describe('PATCH /payments/:id/status', () => {
    const patch = (id: string, body: object, ifMatch?: string) => {
      const req = request(app).patch(`/api/v1/payments/${id}/status`).send(body);
      return ifMatch ? req.set('If-Match', ifMatch) : req;
    };

    it('cancels a pending payment and records why', async () => {
      const { body } = await createPayment();
      const res = await patch(body.data.id, {
        status: 'CANCELLED',
        reason: 'Customer changed their mind',
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CANCELLED', version: 2 });
      expect(res.headers.etag).toBe('"2"');

      const events = eventsOf(body.data.id);
      expect(events.map((e) => e.type)).toEqual([
        PaymentEventType.CREATED,
        PaymentEventType.STATUS_CHANGED,
      ]);
      expect(events[1]).toMatchObject({
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        reason: 'Customer changed their mind',
        metadata: { actor: 'client' },
      });
    });

    it('refunds a succeeded payment', async () => {
      const { body } = await createPayment();
      await forceStatus(body.data.id, PaymentStatus.SUCCEEDED);
      const res = await patch(body.data.id, { status: 'REFUNDED' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REFUNDED');
    });

    it('rejects transitions the state machine forbids, saying what is allowed', async () => {
      const { body } = await createPayment();
      await forceStatus(body.data.id, PaymentStatus.FAILED);

      const res = await patch(body.data.id, { status: 'REFUNDED' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'Cannot move a FAILED payment to REFUNDED',
        error: {
          code: ErrorCode.INVALID_STATE_TRANSITION,
          details: { from: 'FAILED', to: 'REFUNDED', allowed: [] },
        },
      });
      expect(count('paymentEvents')).toBe(1);
    });

    it('does not let clients set system-only statuses', async () => {
      const { body } = await createPayment();
      const res = await patch(body.data.id, { status: 'SUCCEEDED' });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({
        location: 'body',
        field: 'status',
      });
    });

    it('honours If-Match: applies on the current version, 412 on a stale one', async () => {
      const { body } = await createPayment();
      const id = body.data.id;

      const stale = await patch(id, { status: 'CANCELLED' }, '"7"');
      expect(stale.status).toBe(412);
      expect(stale.body.error).toEqual({
        code: ErrorCode.PRECONDITION_FAILED,
        details: { expectedVersion: 7, currentVersion: 1 },
      });

      const current = await patch(id, { status: 'CANCELLED' }, '"1"');
      expect(current.status).toBe(200);
    });

    it('rejects a malformed If-Match', async () => {
      const { body } = await createPayment();
      const res = await patch(body.data.id, { status: 'CANCELLED' }, 'version-1');
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({
        location: 'headers',
        field: 'If-Match',
      });
    });

    it('lets exactly one of many concurrent cancels win', async () => {
      const { body } = await createPayment();
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => patch(body.data.id, { status: 'CANCELLED' })),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      // Losers re-read, see CANCELLED, and get the state-machine answer (not a lost update).
      expect(
        responses
          .filter((r) => r.status !== 200)
          .every(
            (r) =>
              r.status === 409 &&
              [
                ErrorCode.INVALID_STATE_TRANSITION,
                ErrorCode.CONCURRENT_MODIFICATION,
              ].includes(r.body.error.code),
          ),
      ).toBe(true);

      const changes = eventsOf(body.data.id).filter(
        (e) => e.type === PaymentEventType.STATUS_CHANGED,
      );
      expect(changes).toHaveLength(1);
      const final = store.get('payments', body.data.id);
      expect(final).toMatchObject({ status: 'CANCELLED', version: 2 });
    });

    it('404s for an unknown payment', async () => {
      const res = await patch('6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70', {
        status: 'CANCELLED',
      });
      expect(res.status).toBe(404);
    });
  });
});
