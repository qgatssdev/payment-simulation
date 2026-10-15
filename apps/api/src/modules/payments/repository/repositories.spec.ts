import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardBrand, PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { PaymentStore } from '../../../infra/store/payment-store';
import { ConflictError } from '../../../libs/core/errors';
import { createTestStore } from '../../../test/app';
import { JobStatus } from '../../processing/entity/job.entity';
import { JobRepository } from '../../processing/repository/job.repository';
import type { NewPayment } from './payment.repository';
import { PaymentRepository, percentile } from './payment.repository';
import { IdempotencyKeyRepository } from './idempotency-key.repository';
import { PaymentEventRepository } from './payment-event.repository';

const NOW = new Date('2026-10-15T12:00:00.000Z');

const newPayment = (overrides: Partial<NewPayment> = {}): NewPayment => ({
  amount: 250_000,
  currency: 'NGN',
  customerEmail: 'ada@example.com',
  description: null,
  paymentMethod: {
    token: 'tok_sim_succeed_0123456789abcdef',
    brand: CardBrand.VISA,
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
  },
  ...overrides,
});

describe('repositories on the JSON store', () => {
  let store: PaymentStore;
  let payments: PaymentRepository;

  beforeEach(async () => {
    store = await createTestStore({ clock: () => NOW });
    payments = new PaymentRepository(store);
  });

  describe('PaymentRepository', () => {
    it('inserts a payment with defaults and reads it back as a Payment', async () => {
      const saved = await payments.insert(newPayment());
      const loaded = await payments.findById(saved.id);

      expect(loaded).toMatchObject({
        id: saved.id,
        amount: 250_000,
        status: PaymentStatus.PENDING,
        attempts: 0,
        version: 1,
        processedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(typeof loaded?.transitionTo).toBe('function');
    });

    it('hands out copies: changing a loaded payment changes nothing stored', async () => {
      const saved = await payments.insert(newPayment());
      const loaded = (await payments.findById(saved.id))!;
      loaded.status = PaymentStatus.SUCCEEDED;
      expect((await payments.findById(saved.id))?.status).toBe(PaymentStatus.PENDING);
    });

    it('updates only at the expected version, bumping it', async () => {
      const saved = await payments.insert(newPayment());
      saved.status = PaymentStatus.PROCESSING;

      expect(await payments.updateIfVersion(saved, 7)).toBeNull();
      const updated = await payments.updateIfVersion(saved, 1);
      expect(updated).toMatchObject({ status: PaymentStatus.PROCESSING, version: 2 });
      expect(await payments.updateIfVersion(saved, 1)).toBeNull(); // now stale
    });

    it('returns null for unknown ids and finds several by id', async () => {
      const a = await payments.insert(newPayment());
      const b = await payments.insert(newPayment());
      expect(await payments.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(
        (await payments.findByIds([a.id, b.id, 'nope'])).map((p) => p.id).sort(),
      ).toEqual([a.id, b.id].sort());
    });

    it('rolls back with its transaction when bound to one', async () => {
      await expect(
        store.transaction(async (tx) => {
          await payments.withTransaction(tx).insert(newPayment());
          expect(await payments.withTransaction(tx).count()).toBe(1);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(await payments.count()).toBe(0);
      expect(payments.withTransaction({} as never)).toBeInstanceOf(PaymentRepository);
    });
  });

  describe('percentile (same definition as percentile_cont)', () => {
    it.each([
      [[], 0.5, null],
      [[42], 0.95, 42],
      [[100, 200, 300, 400, 500], 0.5, 300],
      [[100, 200, 300, 400, 500], 0.95, 480],
      [[10, 20], 0.5, 15],
    ])('%j at p=%d is %p', (values, p, expected) => {
      expect(percentile(values, p)).toBe(expected);
    });
  });

  describe('PaymentEventRepository', () => {
    it('draws strictly increasing sequences inside the transaction and defaults fields', async () => {
      const payment = await payments.insert(newPayment());
      const events = new PaymentEventRepository(store);
      const first = await events.append({
        paymentId: payment.id,
        type: PaymentEventType.CREATED,
      });
      const second = await events.append({
        paymentId: payment.id,
        type: PaymentEventType.STATUS_CHANGED,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.PROCESSING,
        metadata: { attempt: 1 },
      });

      expect(second.sequence).toBe(first.sequence + 1);
      expect(first).toMatchObject({ metadata: {}, reason: null, fromStatus: null });
      expect((await events.listForPayment(payment.id)).map((e) => e.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect((await events.listAfter(first.sequence, 10)).map((e) => e.id)).toEqual([
        second.id,
      ]);
    });

    it('does not burn a sequence number when the transaction rolls back', async () => {
      const payment = await payments.insert(newPayment());
      const events = new PaymentEventRepository(store);
      await store
        .transaction(async (tx) => {
          await events
            .withTransaction(tx)
            .append({ paymentId: payment.id, type: PaymentEventType.CREATED });
          throw new Error('abort');
        })
        .catch(() => undefined);
      const next = await events.append({
        paymentId: payment.id,
        type: PaymentEventType.CREATED,
      });
      expect(next.sequence).toBe(1);
    });
  });

  describe('JobRepository', () => {
    it('allows only one active job per payment', async () => {
      const payment = await payments.insert(newPayment());
      const jobs = new JobRepository(store);
      const job = await jobs.enqueuePaymentProcessing(payment.id, 4);
      expect(job).toMatchObject({
        status: JobStatus.QUEUED,
        attempts: 0,
        maxAttempts: 4,
      });

      await expect(jobs.enqueuePaymentProcessing(payment.id)).rejects.toBeInstanceOf(
        ConflictError,
      );

      const [claimed] = await jobs.claimDue(1, 'worker-a', NOW);
      await jobs.complete(claimed!, NOW);
      await expect(jobs.enqueuePaymentProcessing(payment.id)).resolves.toMatchObject({
        maxAttempts: 5,
      });
    });

    it('claims due jobs oldest first and never the same job twice', async () => {
      const jobs = new JobRepository(store);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const p = await payments.insert(newPayment());
        ids.push((await jobs.enqueuePaymentProcessing(p.id)).id);
      }
      const [a, b] = await Promise.all([
        jobs.claimDue(3, 'worker-a', NOW),
        jobs.claimDue(3, 'worker-b', NOW),
      ]);
      const claimed = [...a, ...b].map((j) => j.id);
      expect(new Set(claimed).size).toBe(5);
      expect(claimed.sort()).toEqual([...ids].sort());
      expect(a.every((j) => j.lockedBy === 'worker-a' && j.attempts === 1)).toBe(true);
    });

    it('does not claim jobs scheduled for later', async () => {
      const jobs = new JobRepository(store);
      const p = await payments.insert(newPayment());
      const job = await jobs.enqueuePaymentProcessing(p.id);
      const [claimed] = await jobs.claimDue(1, 'w', NOW);
      await jobs.retryAt(claimed!, new Date(NOW.getTime() + 60_000), 'later');

      expect(await jobs.claimDue(1, 'w', NOW)).toEqual([]);
      expect(await jobs.claimDue(1, 'w', new Date(NOW.getTime() + 60_000))).toMatchObject(
        [{ id: job.id, attempts: 2 }],
      );
    });
  });

  describe('IdempotencyKeyRepository', () => {
    it('refuses to work outside a transaction', async () => {
      const keys = new IdempotencyKeyRepository(store);
      await expect(keys.claim('k', 'h', NOW, NOW)).rejects.toThrow(
        'must be bound to a transaction',
      );
    });

    it('purges expired keys and keeps live ones', async () => {
      const keys = new IdempotencyKeyRepository(store);
      await store.transaction(async (tx) => {
        await keys
          .withTransaction(tx)
          .claim('old', 'h', NOW, new Date(NOW.getTime() - 1));
        await keys
          .withTransaction(tx)
          .claim('live', 'h', NOW, new Date(NOW.getTime() + 1));
      });
      expect(await keys.purgeExpired(NOW)).toBe(1);
      expect(store.get('idempotencyKeys', 'old')).toBeUndefined();
      expect(store.get('idempotencyKeys', 'live')).toBeDefined();
    });
  });
});

describe('persistence across restarts', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'payments-store-'));
    file = join(dir, 'payments.json');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('keeps payments, events, jobs and sequences', async () => {
    const first = await createTestStore({ file, clock: () => NOW });
    const payment = await new PaymentRepository(first).insert(newPayment());
    await new PaymentEventRepository(first).append({
      paymentId: payment.id,
      type: PaymentEventType.CREATED,
    });
    await new JobRepository(first).enqueuePaymentProcessing(payment.id);
    await first.close();

    const second = await createTestStore({ file });
    const reloaded = await new PaymentRepository(second).findById(payment.id);
    expect(reloaded).toMatchObject({ amount: 250_000, createdAt: NOW, version: 1 });
    expect(reloaded?.createdAt).toBeInstanceOf(Date);
    expect(await new JobRepository(second).findForPayment(payment.id)).toHaveLength(1);
    const next = await new PaymentEventRepository(second).append({
      paymentId: payment.id,
      type: PaymentEventType.STATUS_CHANGED,
    });
    expect(next.sequence).toBe(2);
    await second.close();
  });
});
