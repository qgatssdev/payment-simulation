import { ErrorCode, PaymentStatus } from '@payment-sim/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import {
  closeIntegrationApps,
  createIntegrationApp,
  createTestDataSource,
  truncateAll,
} from '../../test/database';
import { Payment } from './entity/payment.entity';

describe('payment queries', () => {
  let dataSource: DataSource;
  let app: Express;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    ({ app } = await createIntegrationApp(dataSource));
  });

  beforeEach(() => truncateAll(dataSource));

  afterAll(async () => {
    await closeIntegrationApps();
    await dataSource.destroy();
  });

  /** Insert rows directly: these tests are about reading, not about the create path. */
  async function seed(
    rows: Array<
      Omit<Partial<Payment>, 'createdAt'> & {
        createdAt?: string;
        processedAfterMs?: number;
      }
    >,
  ): Promise<string[]> {
    const repo = dataSource.getRepository(Payment);
    const ids: string[] = [];
    for (const { createdAt, processedAfterMs, ...row } of rows) {
      const saved = await repo.save(
        repo.create({
          amount: 1000,
          currency: 'USD',
          customerEmail: 'ada@example.com',
          paymentMethod: {
            token: 'tok_sim_succeed_0123456789abcdef',
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2030,
          } as Payment['paymentMethod'],
          ...row,
        }),
      );
      if (createdAt) {
        await dataSource.query('UPDATE payments SET created_at = $2 WHERE id = $1', [
          saved.id,
          createdAt,
        ]);
      }
      if (processedAfterMs !== undefined) {
        await dataSource.query(
          `UPDATE payments SET processed_at = created_at + make_interval(secs => $2::float / 1000)
           WHERE id = $1`,
          [saved.id, processedAfterMs],
        );
      }
      ids.push(saved.id);
    }
    return ids;
  }

  const list = (query: Record<string, string | number> = {}) =>
    request(app).get('/api/v1/payments').query(query);

  describe('GET /payments', () => {
    it('walks every row exactly once, newest first, even with identical timestamps', async () => {
      // 10 rows share one microsecond-precise timestamp: only the id tie-break orders them.
      const tied = Array.from({ length: 10 }, () => ({
        createdAt: '2026-10-01T09:00:00.123456Z',
      }));
      const spread = Array.from({ length: 15 }, (_, i) => ({
        createdAt: `2026-10-0${1 + (i % 9)}T10:00:00.${String(100000 + i)}Z`,
      }));
      await seed([...tied, ...spread]);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await list({ limit: 7, ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        seen.push(...res.body.data.map((p: { id: string }) => p.id));
        cursor = res.body.pagination.nextCursor ?? undefined;
        expect(res.body.pagination.hasMore).toBe(cursor !== undefined);
        pages++;
      } while (cursor);

      const expected = await dataSource.query<Array<{ id: string }>>(
        'SELECT id FROM payments ORDER BY created_at DESC, id DESC',
      );
      expect(pages).toBe(4);
      expect(seen).toEqual(expected.map((r) => r.id));
    });

    it('defaults to 20 per page and reports the limit used', async () => {
      await seed(Array.from({ length: 21 }, () => ({})));
      const res = await list();
      expect(res.body.data).toHaveLength(20);
      expect(res.body.pagination).toMatchObject({ limit: 20, hasMore: true });
    });

    it('filters by status, currency and creation window', async () => {
      await seed([
        {
          status: PaymentStatus.FAILED,
          currency: 'USD',
          createdAt: '2026-09-01T00:00:00.000000Z',
        },
        {
          status: PaymentStatus.FAILED,
          currency: 'NGN',
          createdAt: '2026-09-15T00:00:00.000000Z',
        },
        {
          status: PaymentStatus.SUCCEEDED,
          currency: 'NGN',
          createdAt: '2026-09-20T00:00:00.000000Z',
        },
        {
          status: PaymentStatus.FAILED,
          currency: 'NGN',
          createdAt: '2026-10-05T00:00:00.000000Z',
        },
      ]);

      const failedNgn = await list({ status: 'FAILED', currency: 'ngn' });
      expect(failedNgn.body.data).toHaveLength(2);

      const septemberFailedNgn = await list({
        status: 'FAILED',
        currency: 'NGN',
        from: '2026-09-01T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
      });
      expect(septemberFailedNgn.body.data).toHaveLength(1);
      expect(septemberFailedNgn.body.data[0].createdAt).toBe('2026-09-15T00:00:00.000Z');
    });

    it('rejects bad cursors and limits with query validation errors', async () => {
      const badCursor = await list({ cursor: 'definitely-not-a-cursor' });
      expect(badCursor.status).toBe(400);
      expect(badCursor.body.error.details).toEqual([
        {
          location: 'query',
          field: 'cursor',
          messages: ['cursor is not a valid page cursor'],
        },
      ]);

      const badLimit = await list({ limit: 500 });
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const unknown = await list({ sort: 'amount' });
      expect(unknown.status).toBe(400);
    });
  });

  describe('GET /payments/:id/events', () => {
    it('returns the timeline in order with sequence numbers', async () => {
      const created = await request(app)
        .post('/api/v1/payments')
        .set('Idempotency-Key', `events-${Date.now()}`)
        .send({
          amount: 1000,
          currency: 'USD',
          customerEmail: 'ada@example.com',
          card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123' },
        });
      const id = created.body.data.id as string;
      await request(app).patch(`/api/v1/payments/${id}/status`).send({
        status: 'CANCELLED',
        reason: 'duplicate order',
      });

      const res = await request(app).get(`/api/v1/payments/${id}/events`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject([
        { type: 'payment.created', fromStatus: null, toStatus: 'PENDING' },
        {
          type: 'payment.status_changed',
          fromStatus: 'PENDING',
          toStatus: 'CANCELLED',
          reason: 'duplicate order',
        },
      ]);
      expect(res.body.data[1].sequence).toBeGreaterThan(res.body.data[0].sequence);
    });

    it('404s for an unknown payment', async () => {
      const res = await request(app).get(
        '/api/v1/payments/6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70/events',
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /stats', () => {
    it('is all zeros and nulls on an empty table', async () => {
      const res = await request(app).get('/api/v1/stats');
      expect(res.body.data).toEqual({
        countsByStatus: {
          PENDING: 0,
          PROCESSING: 0,
          SUCCEEDED: 0,
          FAILED: 0,
          CANCELLED: 0,
          REFUNDED: 0,
        },
        total: 0,
        successRate: null,
        volumeByCurrency: {},
        processingTimeMs: { p50: null, p95: null },
      });
    });

    it('aggregates counts, success rate, captured volume and processing time', async () => {
      await seed([
        {
          status: PaymentStatus.SUCCEEDED,
          currency: 'USD',
          amount: 1000,
          processedAfterMs: 100,
        },
        {
          status: PaymentStatus.SUCCEEDED,
          currency: 'USD',
          amount: 500,
          processedAfterMs: 200,
        },
        {
          status: PaymentStatus.SUCCEEDED,
          currency: 'NGN',
          amount: 250_000,
          processedAfterMs: 300,
        },
        {
          status: PaymentStatus.REFUNDED,
          currency: 'USD',
          amount: 9_999,
          processedAfterMs: 400,
        },
        {
          status: PaymentStatus.FAILED,
          currency: 'USD',
          amount: 700,
          processedAfterMs: 500,
        },
        { status: PaymentStatus.PENDING },
        { status: PaymentStatus.CANCELLED },
      ]);

      const res = await request(app).get('/api/v1/stats');
      expect(res.body.data).toEqual({
        countsByStatus: {
          PENDING: 1,
          PROCESSING: 0,
          SUCCEEDED: 3,
          FAILED: 1,
          CANCELLED: 1,
          REFUNDED: 1,
        },
        total: 7,
        // Approved (3 succeeded + 1 later refunded) out of 5 processed.
        successRate: 0.8,
        // Only money currently captured: the refund is excluded.
        volumeByCurrency: { USD: 1500, NGN: 250_000 },
        // percentile_cont over [100, 200, 300, 400, 500].
        processingTimeMs: { p50: 300, p95: 480 },
      });
    });
  });
});
