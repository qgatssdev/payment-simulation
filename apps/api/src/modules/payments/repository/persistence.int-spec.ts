import {
  CardBrand,
  ErrorCode,
  PaymentEventType,
  PaymentStatus,
} from '@payment-sim/shared';
import type { DataSource } from 'typeorm';
import { ConflictError, mapDatabaseError } from '../../../libs/core/errors';
import { createTestDataSource, truncateAll } from '../../../test/database';
import { Job, JobStatus, JobType } from '../../processing/entity/job.entity';
import { IdempotencyKey } from '../entity/idempotency-key.entity';
import { PaymentEvent } from '../entity/payment-event.entity';
import type { Payment } from '../entity/payment.entity';
import { PaymentRepository } from './payment.repository';

describe('persistence', () => {
  let dataSource: DataSource;
  let payments: PaymentRepository;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    payments = new PaymentRepository(dataSource.manager);
  });

  beforeEach(() => truncateAll(dataSource));

  afterAll(() => dataSource.destroy());

  const newPayment = (overrides: Partial<Payment> = {}): Payment =>
    payments.create({
      amount: 250_000,
      currency: 'NGN',
      customerEmail: 'ada@example.com',
      paymentMethod: {
        token: 'tok_sim_succeed_0123456789abcdef',
        brand: CardBrand.VISA,
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      },
      ...overrides,
    });

  describe('payments', () => {
    it('round-trips a payment with database defaults applied', async () => {
      const saved = await payments.save(newPayment());
      const loaded = await payments.findById(saved.id);

      expect(loaded).toMatchObject({
        id: saved.id,
        amount: 250_000,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        attempts: 0,
        version: 1,
        description: null,
        processedAt: null,
        paymentMethod: {
          token: 'tok_sim_succeed_0123456789abcdef',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2030,
        },
      });
      expect(typeof loaded?.amount).toBe('number');
      expect(loaded?.createdAt).toBeInstanceOf(Date);
    });

    it('keeps amounts above 2^31 exact', async () => {
      const saved = await payments.save(newPayment({ amount: 9_999_999_999 }));
      expect((await payments.findById(saved.id))?.amount).toBe(9_999_999_999);
    });

    it('stores the card under card_* columns, never a full number', async () => {
      const saved = await payments.save(newPayment());
      const [row] = await dataSource.query<Record<string, unknown>[]>(
        'SELECT * FROM payments WHERE id = $1',
        [saved.id],
      );
      expect(
        Object.keys(row ?? {})
          .filter((k) => k.startsWith('card_'))
          .sort(),
      ).toEqual([
        'card_brand',
        'card_exp_month',
        'card_exp_year',
        'card_last4',
        'card_token',
      ]);
    });

    it('bumps version and updatedAt on every save', async () => {
      const saved = await payments.save(newPayment());
      const firstUpdatedAt = saved.updatedAt;
      saved.status = PaymentStatus.PROCESSING;
      const updated = await payments.save(saved);
      expect(updated.version).toBe(2);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        firstUpdatedAt.getTime(),
      );
    });

    it('rejects non-positive amounts at the database too', async () => {
      await expect(payments.save(newPayment({ amount: 0 }))).rejects.toMatchObject({
        driverError: { code: '23514', constraint: 'chk_payments_amount_positive' },
      });
    });

    it('returns null and false for unknown ids', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      expect(await payments.findById(missing)).toBeNull();
      expect(await payments.exists({ id: missing })).toBe(false);
      expect(await payments.count()).toBe(0);
    });
  });

  describe('transactions', () => {
    it('withTransaction binds writes to the transaction and rolls back with it', async () => {
      await expect(
        dataSource.transaction(async (manager) => {
          await payments.withTransaction(manager).save(newPayment());
          expect(await payments.withTransaction(manager).count()).toBe(1);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');

      expect(await payments.count()).toBe(0);
    });

    it('withTransaction returns the same repository type', () => {
      expect(payments.withTransaction(dataSource.manager)).toBeInstanceOf(
        PaymentRepository,
      );
    });
  });

  describe('payment events', () => {
    it('assigns a strictly increasing sequence and defaults metadata to {}', async () => {
      const payment = await payments.save(newPayment());
      const events = dataSource.getRepository(PaymentEvent);
      const first = await events.save(
        events.create({ paymentId: payment.id, type: PaymentEventType.CREATED }),
      );
      const second = await events.save(
        events.create({
          paymentId: payment.id,
          type: PaymentEventType.STATUS_CHANGED,
          fromStatus: PaymentStatus.PENDING,
          toStatus: PaymentStatus.PROCESSING,
          metadata: { attempt: 1, gateway: { latencyMs: 812 } },
        }),
      );

      const loaded = await events.find({
        where: { paymentId: payment.id },
        order: { sequence: 'ASC' },
      });
      expect(loaded.map((e) => e.id)).toEqual([first.id, second.id]);
      expect(second.sequence).toBeGreaterThan(first.sequence);
      expect(loaded[0]?.metadata).toEqual({});
      expect(loaded[1]?.metadata).toEqual({ attempt: 1, gateway: { latencyMs: 812 } });
    });

    it('are deleted with their payment', async () => {
      const payment = await payments.save(newPayment());
      const events = dataSource.getRepository(PaymentEvent);
      await events.save(
        events.create({ paymentId: payment.id, type: PaymentEventType.CREATED }),
      );
      await dataSource.getRepository('Payment').delete(payment.id);
      expect(await events.count()).toBe(0);
    });
  });

  describe('jobs', () => {
    it('allows only one active job per payment', async () => {
      const payment = await payments.save(newPayment());
      const jobs = dataSource.getRepository(Job);
      const job = jobs.create({ type: JobType.PROCESS_PAYMENT, paymentId: payment.id });
      await jobs.save(job);

      const duplicate = jobs.save(
        jobs.create({ type: JobType.PROCESS_PAYMENT, paymentId: payment.id }),
      );
      const error = await duplicate.catch((e: unknown) => e);
      expect(error).toMatchObject({
        driverError: { constraint: 'uq_jobs_active_payment' },
      });
      expect(mapDatabaseError(error)).toBeInstanceOf(ConflictError);
      expect(mapDatabaseError(error)?.code).toBe(ErrorCode.CONFLICT);

      // Once the first job is finished, a new one may be queued.
      job.status = JobStatus.COMPLETED;
      await jobs.save(job);
      await expect(
        jobs.save(jobs.create({ type: JobType.PROCESS_PAYMENT, paymentId: payment.id })),
      ).resolves.toMatchObject({ status: JobStatus.QUEUED, attempts: 0, maxAttempts: 5 });
    });
  });

  describe('idempotency keys', () => {
    it('stores a JSON response snapshot and nulls the payment link if the payment goes', async () => {
      const payment = await payments.save(newPayment());
      const keys = dataSource.getRepository(IdempotencyKey);
      await keys.save(
        keys.create({
          key: 'order-1001',
          requestHash: 'a'.repeat(64),
          paymentId: payment.id,
          responseStatus: 202,
          responseBody: { success: true, data: { id: payment.id } },
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );
      await dataSource.getRepository('Payment').delete(payment.id);

      const stored = await keys.findOneByOrFail({ key: 'order-1001' });
      expect(stored).toMatchObject({
        responseStatus: 202,
        responseBody: { success: true, data: { id: payment.id } },
        paymentId: null,
      });
    });
  });
});
