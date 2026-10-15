import { CardBrand, PaymentFailureCode, TEST_CARDS } from '@payment-sim/shared';
import { MockPaymentGateway } from './mock-payment-gateway';
import { GatewayError } from './payment-gateway';

const card = (number: string) => ({ number, expMonth: 12, expYear: 2030, cvc: '123' });
const TEST = Object.fromEntries(TEST_CARDS.map((c) => [c.label, c.number]));

function gateway(random = () => 0.5, latency = 0) {
  return new MockPaymentGateway({
    minLatencyMs: latency,
    maxLatencyMs: latency,
    declineRate: 0.1,
    transientErrorRate: 0.2,
    random,
  });
}

let seq = 0;
const charge = (
  gw: MockPaymentGateway,
  number: string,
  attempt = 1,
  signal = new AbortController().signal,
) =>
  gw.charge(
    {
      token: gw.tokenize(card(number)).token,
      amount: 1000,
      currency: 'USD',
      idempotencyKey: `pay-${++seq}`,
      attempt,
    },
    signal,
  );

describe('MockPaymentGateway', () => {
  describe('tokenize', () => {
    it('returns an opaque token plus the display details, never the card number', () => {
      const result = gateway().tokenize(card('4242424242424242'));
      expect(result).toEqual({
        token: expect.stringMatching(/^tok_sim_succeed_[0-9a-f]{16}$/) as unknown,
        brand: CardBrand.VISA,
        last4: '4242',
      });
      expect(result.token).not.toContain('424242424242');
    });

    it('issues a fresh token per tokenization', () => {
      const gw = gateway();
      expect(gw.tokenize(card('4242424242424242')).token).not.toBe(
        gw.tokenize(card('4242424242424242')).token,
      );
    });
  });

  describe('charge with test cards', () => {
    it('approves the success cards', async () => {
      const gw = gateway();
      for (const number of [TEST.Success, TEST['Success (Mastercard)']]) {
        await expect(charge(gw, number as string)).resolves.toMatchObject({
          status: 'approved',
          authorizationCode: expect.stringMatching(/^AUTH[0-9A-F]{6}$/) as unknown,
        });
      }
      expect(gw.approvedCharges).toBe(2);
    });

    it.each([
      ['Declined', PaymentFailureCode.CARD_DECLINED],
      ['Insufficient funds', PaymentFailureCode.INSUFFICIENT_FUNDS],
    ])('declines "%s" with %s', async (label, code) => {
      await expect(charge(gateway(), TEST[label] as string)).resolves.toMatchObject({
        status: 'declined',
        code,
      });
    });

    it('fails the flaky card retryably twice, then approves', async () => {
      const gw = gateway();
      const token = gw.tokenize(card(TEST['Flaky gateway'] as string)).token;
      const attempt = (n: number) =>
        gw.charge(
          { token, amount: 1, currency: 'USD', idempotencyKey: 'flaky', attempt: n },
          new AbortController().signal,
        );

      for (const n of [1, 2]) {
        const error = await attempt(n).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GatewayError);
        expect(error).toMatchObject({
          retryable: true,
          code: PaymentFailureCode.PROCESSING_ERROR,
        });
      }
      await expect(attempt(3)).resolves.toMatchObject({ status: 'approved' });
    });

    it('never answers for the timeout card until the caller aborts', async () => {
      const startedAt = Date.now();
      const error = await charge(
        gateway(),
        TEST['Gateway timeout'] as string,
        1,
        AbortSignal.timeout(30),
      ).catch((e: unknown) => e);
      expect((error as Error).name).toBe('AbortError');
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
    });
  });

  describe('charge with other cards (random behaviour)', () => {
    const other = '4111111111111111';

    it.each([
      [0.05, 'declined'],
      [0.25, 'transient'],
      [0.5, 'approved'],
    ])('random %d → %s', async (roll, expected) => {
      const result = charge(
        gateway(() => roll),
        other,
      );
      if (expected === 'transient') {
        await expect(result).rejects.toMatchObject({ retryable: true });
      } else {
        await expect(result).resolves.toMatchObject({ status: expected });
      }
    });
  });

  it('replays a settled result for the same idempotency key instead of charging twice', async () => {
    const gw = gateway();
    const request = {
      token: gw.tokenize(card(TEST.Success as string)).token,
      amount: 1000,
      currency: 'USD' as const,
      idempotencyKey: 'pay-once',
      attempt: 1,
    };
    const first = await gw.charge(request, new AbortController().signal);
    const second = await gw.charge(
      { ...request, attempt: 2 },
      new AbortController().signal,
    );
    expect(second).toEqual(first);
    expect(gw.approvedCharges).toBe(1);
  });

  it('honours configured latency', async () => {
    const result = await charge(
      gateway(() => 0.5, 40),
      TEST.Success as string,
    );
    expect(result.latencyMs).toBeGreaterThanOrEqual(35);
  });

  it('rejects tokens it did not issue, without retry', async () => {
    const error = await gateway()
      .charge(
        {
          token: 'tok_unavailable',
          amount: 1,
          currency: 'USD',
          idempotencyKey: 'x',
          attempt: 1,
        },
        new AbortController().signal,
      )
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      retryable: false,
      code: PaymentFailureCode.PROCESSING_ERROR,
    });
  });
});
