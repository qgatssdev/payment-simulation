import { setTimeout as sleep } from 'node:timers/promises';
import { PaymentEventType, PaymentStatus, TEST_CARDS } from '@payment-sim/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { Container } from '../../../container';
import type { MockPaymentGateway } from '../../../infra/gateway/mock-payment-gateway';
import {
  closeIntegrationApps,
  createIntegrationApp,
  createTestDataSource,
  truncateAll,
} from '../../../test/database';
import { PaymentEvent } from '../../payments/entity/payment-event.entity';
import { Payment } from '../../payments/entity/payment.entity';
import { PaymentService } from '../../payments/services/payment.service';
import { Job, JobStatus } from '../entity/job.entity';
import { JobRepository } from '../repository/job.repository';
import type { PaymentWorker } from './payment-worker';

const CARD = Object.fromEntries(TEST_CARDS.map((c) => [c.label, c.number])) as Record<
  string,
  string
>;

const approvedCharges = (c: Container) =>
  (c.gateway as MockPaymentGateway).approvedCharges;

/** No latency, no backoff, a short gateway deadline: the suite runs in real time, quickly. */
const FAST_ENV = {
  GATEWAY_MIN_LATENCY_MS: '0',
  GATEWAY_MAX_LATENCY_MS: '0',
  GATEWAY_TIMEOUT_MS: '50',
  RETRY_BASE_DELAY_MS: '0',
  RETRY_MAX_DELAY_MS: '0',
  JOB_MAX_ATTEMPTS: '3',
  WORKER_CONCURRENCY: '4',
  WORKER_POLL_INTERVAL_MS: '20',
};

describe('payment worker', () => {
  let dataSource: DataSource;
  let app: Express;
  let container: Container;
  let worker: PaymentWorker;
  let keySeq = 0;

  const build = (env: Record<string, string> = {}) =>
    createIntegrationApp(dataSource, { random: () => 0.5 }, { ...FAST_ENV, ...env });

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    ({ app, container } = await build());
    worker = container.worker;
  });

  beforeEach(() => truncateAll(dataSource));
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await closeIntegrationApps();
    await dataSource.destroy();
  });

  async function createPayment(
    cardNumber: string,
    target: Express = app,
  ): Promise<string> {
    const res = await request(target)
      .post('/api/v1/payments')
      .set('Idempotency-Key', `worker-test-${++keySeq}`)
      .send({
        amount: 5000,
        currency: 'USD',
        customerEmail: 'ada@example.com',
        card: { number: cardNumber, expMonth: 12, expYear: 2030, cvc: '123' },
      });
    expect(res.status).toBe(202);
    return res.body.data.id as string;
  }

  /** Drive workers tick by tick until no job is due or running. Deterministic, no sleeps. */
  async function runUntilIdle(...workers: PaymentWorker[]): Promise<void> {
    for (let round = 0; round < 100; round++) {
      const started = await Promise.all(
        (workers.length ? workers : [worker]).map((w) => w.tick()),
      );
      await Promise.all((workers.length ? workers : [worker]).map((w) => w.drain()));
      if (started.every((n) => n === 0)) return;
    }
    throw new Error('workers did not go idle');
  }

  const paymentOf = (id: string) =>
    dataSource.getRepository(Payment).findOneByOrFail({ id });
  const jobOf = (paymentId: string) =>
    dataSource.getRepository(Job).findOneByOrFail({ paymentId });
  const timeline = async (paymentId: string) =>
    (
      await dataSource
        .getRepository(PaymentEvent)
        .find({ where: { paymentId }, order: { sequence: 'ASC' } })
    ).map((e) =>
      e.type === PaymentEventType.ATTEMPT_FAILED
        ? `attempt_failed#${String(e.metadata.attempt)}`
        : `${e.toStatus}`,
    );

  describe('outcomes per test card', () => {
    it('charges a good card through to SUCCEEDED', async () => {
      const id = await createPayment(CARD.Success as string);
      await runUntilIdle();

      expect(await paymentOf(id)).toMatchObject({
        status: PaymentStatus.SUCCEEDED,
        attempts: 1,
        failureCode: null,
        processedAt: expect.any(Date) as unknown,
      });
      expect(await timeline(id)).toEqual(['PENDING', 'PROCESSING', 'SUCCEEDED']);
      expect(await jobOf(id)).toMatchObject({
        status: JobStatus.COMPLETED,
        attempts: 1,
        lockedBy: null,
      });

      const succeeded = await dataSource
        .getRepository(PaymentEvent)
        .findOneByOrFail({ paymentId: id, toStatus: PaymentStatus.SUCCEEDED });
      expect(succeeded.metadata).toMatchObject({
        actor: 'system',
        attempt: 1,
        authorizationCode: expect.stringMatching(/^AUTH/) as unknown,
        jobId: expect.any(String) as unknown,
      });
    });

    it.each([
      ['Declined', 'card_declined'],
      ['Insufficient funds', 'insufficient_funds'],
    ])('fails "%s" at once with %s, without retrying', async (label, code) => {
      const charge = jest.spyOn(container.gateway, 'charge');
      const id = await createPayment(CARD[label] as string);
      await runUntilIdle();

      expect(await paymentOf(id)).toMatchObject({
        status: PaymentStatus.FAILED,
        failureCode: code,
        attempts: 1,
      });
      expect(await timeline(id)).toEqual(['PENDING', 'PROCESSING', 'FAILED']);
      expect(charge).toHaveBeenCalledTimes(1);
      expect((await jobOf(id)).status).toBe(JobStatus.COMPLETED);
    });

    it('retries a flaky gateway and records each failed attempt', async () => {
      const id = await createPayment(CARD['Flaky gateway'] as string);
      await runUntilIdle();

      expect(await timeline(id)).toEqual([
        'PENDING',
        'PROCESSING',
        'attempt_failed#1',
        'attempt_failed#2',
        'SUCCEEDED',
      ]);
      expect(await paymentOf(id)).toMatchObject({
        status: PaymentStatus.SUCCEEDED,
        attempts: 3,
      });
      expect(await jobOf(id)).toMatchObject({ status: JobStatus.COMPLETED, attempts: 3 });
    });

    it('gives up on a gateway that keeps timing out, after the attempt budget', async () => {
      const id = await createPayment(CARD['Gateway timeout'] as string);
      await runUntilIdle();

      expect(await timeline(id)).toEqual([
        'PENDING',
        'PROCESSING',
        'attempt_failed#1',
        'attempt_failed#2',
        'FAILED',
      ]);
      const payment = await paymentOf(id);
      expect(payment).toMatchObject({
        status: PaymentStatus.FAILED,
        failureCode: 'gateway_timeout',
        attempts: 3,
      });
      expect(payment.failureMessage).toMatch(/within 50ms; gave up after 3 attempts$/);
    });

    it('fails cleanly for a card token the gateway does not recognise', async () => {
      const id = await createPayment(CARD.Success as string);
      await dataSource.query(
        `UPDATE payments SET card_token = 'tok_unavailable' WHERE id = $1`,
        [id],
      );
      await runUntilIdle();
      expect(await paymentOf(id)).toMatchObject({
        status: PaymentStatus.FAILED,
        failureCode: 'processing_error',
        attempts: 1,
      });
    });
  });

  it('skips a payment cancelled before the worker reached it, without charging', async () => {
    const charge = jest.spyOn(container.gateway, 'charge');
    const id = await createPayment(CARD.Success as string);
    await request(app)
      .patch(`/api/v1/payments/${id}/status`)
      .send({ status: 'CANCELLED' });
    await runUntilIdle();

    expect((await paymentOf(id)).status).toBe(PaymentStatus.CANCELLED);
    expect((await jobOf(id)).status).toBe(JobStatus.COMPLETED);
    expect(charge).not.toHaveBeenCalled();
  });

  it('processes each payment exactly once when two workers compete', async () => {
    const other = await build({ WORKER_CONCURRENCY: '8' });
    const approvedBefore = approvedCharges(container);
    const ids = await Promise.all(
      Array.from({ length: 16 }, () => createPayment(CARD.Success as string)),
    );
    await runUntilIdle(worker, other.container.worker);

    const succeededEvents = await dataSource.getRepository(PaymentEvent).countBy({
      type: PaymentEventType.STATUS_CHANGED,
      toStatus: PaymentStatus.SUCCEEDED,
    });
    expect(succeededEvents).toBe(16);
    // Each container has its own simulated gateway; together they approved each payment once.
    expect(
      approvedCharges(container) - approvedBefore + approvedCharges(other.container),
    ).toBe(16);
    for (const id of ids) expect((await jobOf(id)).attempts).toBe(1);
  });

  it('does not charge twice when it crashes after the gateway approved', async () => {
    const before = approvedCharges(container);
    const charge = jest.spyOn(container.gateway, 'charge');
    // Taken unbound on purpose: the spy re-binds it with .call(this, ...).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const realTransition = PaymentService.prototype.transition;
    let crashed = false;
    jest.spyOn(PaymentService.prototype, 'transition').mockImplementation(async function (
      this: PaymentService,
      id,
      to,
      ...rest
    ) {
      if (to === PaymentStatus.SUCCEEDED && !crashed) {
        crashed = true;
        throw new Error('connection lost after approval');
      }
      return realTransition.call(this, id, to, ...rest);
    });

    const id = await createPayment(CARD.Success as string);
    await runUntilIdle();

    expect(charge).toHaveBeenCalledTimes(2);
    expect(approvedCharges(container) - before).toBe(1);
    expect(await paymentOf(id)).toMatchObject({ status: PaymentStatus.SUCCEEDED });
    expect(await jobOf(id)).toMatchObject({ status: JobStatus.COMPLETED, attempts: 2 });
  });

  it('fails the job and the payment when processing crashes on every attempt', async () => {
    jest
      .spyOn(container.gateway, 'charge')
      .mockRejectedValue(new Error('unexpected bug'));
    const id = await createPayment(CARD.Success as string);
    await runUntilIdle();

    expect(await jobOf(id)).toMatchObject({
      status: JobStatus.FAILED,
      attempts: 3,
      lastError: 'unexpected bug',
    });
    expect(await paymentOf(id)).toMatchObject({
      status: PaymentStatus.FAILED,
      failureCode: 'processing_error',
    });
  });

  it('re-queues jobs held by a dead worker and ignores that worker if it wakes up', async () => {
    const id = await createPayment(CARD.Success as string);
    const jobs = new JobRepository(dataSource.manager);
    const [orphaned] = await jobs.claimDue(1, 'zombie-worker', new Date());
    expect(orphaned?.paymentId).toBe(id);
    await dataSource.query(
      `UPDATE jobs SET locked_at = now() - interval '10 minutes' WHERE id = $1`,
      [orphaned?.id],
    );

    expect(await worker.reclaimStaleJobs()).toEqual([orphaned?.id]);
    await runUntilIdle();
    expect((await paymentOf(id)).status).toBe(PaymentStatus.SUCCEEDED);

    // The zombie finishing late must not overwrite the job's real outcome.
    expect(await jobs.complete(orphaned as Job, new Date())).toBe(false);
    expect(await jobs.retryAt(orphaned as Job, new Date(), 'late')).toBe(false);
    expect(await jobOf(id)).toMatchObject({ status: JobStatus.COMPLETED, attempts: 2 });
  });

  it('runs on its own once started: picks up new payments immediately and stops cleanly', async () => {
    const { app: liveApp, container: live } = await build({
      WORKER_POLL_INTERVAL_MS: '60000',
    });
    live.worker.start();
    try {
      const id = await createPayment(CARD.Success as string, liveApp);
      // A 60s poll interval: only the enqueue notification can make this fast.
      for (
        let i = 0;
        i < 100 && (await paymentOf(id)).status !== PaymentStatus.SUCCEEDED;
        i++
      ) {
        await sleep(20);
      }
      expect((await paymentOf(id)).status).toBe(PaymentStatus.SUCCEEDED);
    } finally {
      await live.worker.stop();
    }
    expect(live.worker.activeJobs).toBe(0);
  });
});
