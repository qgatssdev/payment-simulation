import { PaymentStatus } from '@payment-sim/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { PaymentStore } from '../../infra/store/payment-store';
import {
  closeTestApps,
  createTestApp,
  createTestStore,
  patchRecord,
} from '../../test/app';
import { PaymentEventRepository } from '../payments/repository/payment-event.repository';
import { PaymentRepository } from '../payments/repository/payment.repository';
import type { Payment } from '../payments/entity/payment.entity';
import { InsightsService } from './services/insights.service';

const NOW = new Date('2026-10-16T12:00:10.000Z');

describe('insights', () => {
  let store: PaymentStore;
  let service: InsightsService;

  beforeEach(async () => {
    store = await createTestStore({ clock: () => NOW });
    service = new InsightsService({
      payments: new PaymentRepository(store),
      events: new PaymentEventRepository(store),
      clock: () => NOW,
    });
  });

  afterEach(() => closeTestApps());

  /** A payment and its audit trail, `minutesAgo` before NOW, settled `tookMs` later. */
  async function payment(
    minutesAgo: number,
    status: PaymentStatus,
    extra: Partial<Payment> & { tookMs?: number; retries?: string[] } = {},
  ): Promise<string> {
    const { tookMs = 800, retries = [], ...fields } = extra;
    const createdAt = new Date(NOW.getTime() - minutesAgo * 60_000);
    const saved = await new PaymentRepository(store).insert({
      amount: fields.amount ?? 10_000,
      currency: fields.currency ?? 'NGN',
      customerEmail: 'ada@example.com',
      description: null,
      paymentMethod: {
        token: 'tok_sim_succeed_0123456789abcdef',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      } as Payment['paymentMethod'],
    });
    const settled =
      status !== PaymentStatus.PENDING && status !== PaymentStatus.PROCESSING;
    const processedAt =
      settled && status !== PaymentStatus.CANCELLED
        ? new Date(createdAt.getTime() + tookMs)
        : null;
    await patchRecord(store, 'payments', saved.id, {
      status,
      createdAt,
      processedAt,
      attempts: fields.attempts ?? (status === PaymentStatus.CANCELLED ? 0 : 1),
      failureCode: fields.failureCode ?? null,
    });

    const events = new PaymentEventRepository(store);
    const at = async (ms: number, event: Parameters<typeof events.append>[0]) => {
      const appended = await events.append(event);
      await patchRecord(store, 'paymentEvents', appended.id, {
        createdAt: new Date(createdAt.getTime() + ms),
      });
    };
    await at(0, {
      paymentId: saved.id,
      type: 'payment.created' as never,
      toStatus: PaymentStatus.PENDING,
    });
    for (const [i, code] of retries.entries()) {
      await at(100 + i, {
        paymentId: saved.id,
        type: 'payment.attempt_failed' as never,
        metadata: { attempt: i + 1, code },
      });
    }
    if (settled) {
      await at(status === PaymentStatus.CANCELLED ? 10 : tookMs, {
        paymentId: saved.id,
        type: 'payment.status_changed' as never,
        fromStatus: PaymentStatus.PROCESSING,
        toStatus: status === PaymentStatus.REFUNDED ? PaymentStatus.SUCCEEDED : status,
      });
    }
    return saved.id;
  }

  it('buckets activity from the audit log and analyses outcomes for the window', async () => {
    await payment(1, PaymentStatus.SUCCEEDED, { amount: 5_000, tookMs: 1_000 });
    await payment(2, PaymentStatus.SUCCEEDED, {
      amount: 7_000,
      attempts: 3,
      tookMs: 3_000,
      retries: ['processing_error', 'processing_error'],
    });
    await payment(3, PaymentStatus.FAILED, {
      failureCode: 'insufficient_funds' as never,
    });
    await payment(4, PaymentStatus.FAILED, {
      failureCode: 'gateway_timeout' as never,
      attempts: 4,
      retries: ['gateway_timeout', 'gateway_timeout', 'gateway_timeout'],
    });
    await payment(5, PaymentStatus.CANCELLED);
    await payment(0.5, PaymentStatus.PROCESSING);
    await payment(120, PaymentStatus.SUCCEEDED, { amount: 99_000 }); // outside 1h

    const view = await service.insights('1h');

    expect(view.buckets).toHaveLength(30);
    expect(view.to).toBe('2026-10-16T12:02:00.000Z'); // the bucket holding NOW ends here
    expect(view.totals).toMatchObject({
      created: 6,
      succeeded: 2,
      failed: 2,
      cancelled: 1,
      retries: 5,
      approvalRate: 0.5,
      approvedVolumeByCurrency: { NGN: 12_000 },
      inFlight: 1,
      ratePerMinute: 1, // five accepted within the last five minutes; the sixth is exactly 5 old
    });
    expect(view.latencyMs.p50).toBeGreaterThan(0);
    expect(view.failures).toEqual({
      byCode: [
        { code: 'gateway_timeout', count: 1 },
        { code: 'insufficient_funds', count: 1 },
      ],
      retriesByCode: [
        { code: 'gateway_timeout', count: 3 },
        { code: 'processing_error', count: 2 },
      ],
      attempts: [
        { attempts: 1, succeeded: 1, failed: 1 },
        { attempts: 3, succeeded: 1, failed: 0 },
        { attempts: 4, succeeded: 0, failed: 1 },
      ],
      firstAttemptSuccess: 1,
      recoveredByRetry: 1,
      failedAfterRetries: 1,
    });

    const sum = (k: 'created' | 'retries') => view.buckets.reduce((n, b) => n + b[k], 0);
    expect(sum('created')).toBe(6);
    expect(sum('retries')).toBe(5);
  });

  it('reports an empty window without inventing a rate', async () => {
    const view = await service.insights('15m');
    expect(view.buckets).toHaveLength(30);
    expect(view.totals.approvalRate).toBeNull();
    expect(view.latencyMs).toEqual({ p50: null, p95: null });
    expect(view.failures.byCode).toEqual([]);
  });

  it('serves every range over HTTP and rejects unknown ones', async () => {
    const { app }: { app: Express } = await createTestApp(store);
    for (const [range, bars] of [
      ['15m', 30],
      ['1h', 30],
      ['24h', 24],
      ['7d', 28],
    ] as const) {
      const res = await request(app).get('/api/v1/stats/insights').query({ range });
      expect(res.status).toBe(200);
      expect(res.body.data.buckets).toHaveLength(bars);
    }
    const bad = await request(app).get('/api/v1/stats/insights?range=forever');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0]).toMatchObject({
      location: 'query',
      field: 'range',
    });
  });
});
