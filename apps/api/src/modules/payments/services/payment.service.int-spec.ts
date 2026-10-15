import { ErrorCode, PaymentFailureCode, PaymentStatus } from '@payment-sim/shared';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../libs/core/errors';
import {
  createIntegrationApp,
  createTestDataSource,
  truncateAll,
} from '../../../test/database';
import { Payment } from '../entity/payment.entity';
import { PaymentRepository } from '../repository/payment.repository';
import type { PaymentService } from './payment.service';

const NOW = new Date('2026-10-15T12:00:00.000Z');

describe('PaymentService.transition under contention', () => {
  let dataSource: DataSource;
  let service: PaymentService;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    ({
      container: { paymentService: service },
    } = await createIntegrationApp(dataSource, { clock: () => NOW }));
  });

  beforeEach(() => truncateAll(dataSource));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => dataSource.destroy());

  async function pendingPayment(): Promise<Payment> {
    const payments = dataSource.getRepository(Payment);
    return payments.save(
      payments.create({
        amount: 1000,
        currency: 'USD',
        customerEmail: 'ada@example.com',
        paymentMethod: {
          brand: 'visa',
          last4: '4242',
          expMonth: 1,
          expYear: 2030,
        } as never,
      }),
    );
  }

  /**
   * Let another writer change the row after the service has read it but before its
   * conditional UPDATE runs — the exact window optimistic locking exists for.
   */
  function interleave(
    times: number,
    concurrentWrite: (paymentId: string) => Promise<unknown>,
  ) {
    // Taken unbound on purpose: the spy re-binds it with .call(this, ...).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = PaymentRepository.prototype.updateIfVersion;
    let remaining = times;
    return jest
      .spyOn(PaymentRepository.prototype, 'updateIfVersion')
      .mockImplementation(async function (this: PaymentRepository, payment, version) {
        if (remaining-- > 0) await concurrentWrite(payment.id);
        return original.call(this, payment, version);
      });
  }

  const bumpVersion = (id: string) =>
    dataSource.query('UPDATE payments SET version = version + 1 WHERE id = $1', [id]);

  it('re-validates after losing a race instead of overwriting the winner', async () => {
    const payment = await pendingPayment();
    // The worker moves the payment on while the client's cancel is in flight.
    const spy = interleave(1, (id) =>
      dataSource.query(
        `UPDATE payments SET status = 'PROCESSING', version = version + 1 WHERE id = $1`,
        [id],
      ),
    );

    const error = await service
      .transition(payment.id, PaymentStatus.CANCELLED, 'client')
      .catch((e: unknown) => e);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      details: { from: 'PROCESSING', to: 'CANCELLED' },
    });
    const stored = await dataSource
      .getRepository(Payment)
      .findOneByOrFail({ id: payment.id });
    expect(stored.status).toBe(PaymentStatus.PROCESSING);
  });

  it('retries a lost race that is still valid and succeeds', async () => {
    const payment = await pendingPayment();
    const spy = interleave(2, bumpVersion);

    const result = await service.transition(
      payment.id,
      PaymentStatus.CANCELLED,
      'client',
    );

    expect(spy).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ status: PaymentStatus.CANCELLED, version: 4 });
  });

  it('gives up with CONCURRENT_MODIFICATION after the retry budget', async () => {
    const payment = await pendingPayment();
    interleave(Infinity, bumpVersion);

    await expect(
      service.transition(payment.id, PaymentStatus.CANCELLED, 'client'),
    ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION, status: 409 });
  });

  it('does not retry when the caller pinned a version with If-Match', async () => {
    const payment = await pendingPayment();
    const spy = interleave(1, bumpVersion);

    await expect(
      service.transition(payment.id, PaymentStatus.CANCELLED, 'client', {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.PRECONDITION_FAILED,
      details: { expectedVersion: 1, currentVersion: 2 },
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applies system transitions with extra changes and stamps processedAt', async () => {
    const payment = await pendingPayment();
    await service.transition(payment.id, PaymentStatus.PROCESSING, 'system');
    const failed = await service.transition(payment.id, PaymentStatus.FAILED, 'system', {
      reason: 'Issuer declined',
      metadata: { attempt: 1 },
      mutate: (p) => {
        p.failureCode = PaymentFailureCode.CARD_DECLINED;
        p.failureMessage = 'Card declined by issuer';
        p.attempts = 1;
      },
    });

    expect(failed).toMatchObject({
      status: PaymentStatus.FAILED,
      failureCode: 'card_declined',
      failureMessage: 'Card declined by issuer',
      attempts: 1,
      processedAt: NOW,
      version: 3,
    });
  });
});
