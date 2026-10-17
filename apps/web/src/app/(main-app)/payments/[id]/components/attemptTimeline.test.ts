import type { PaymentEventView, PaymentView } from '@payment-sim/shared';
import { attemptsFrom } from './attemptTimeline';

const t = (ms: number) => new Date(Date.UTC(2026, 9, 16, 12, 0, 0) + ms).toISOString();
const event = (
  sequence: number,
  at: number,
  e: Partial<PaymentEventView>,
): PaymentEventView =>
  ({
    id: `e${sequence}`,
    sequence,
    paymentId: 'p1',
    fromStatus: null,
    toStatus: null,
    reason: null,
    metadata: {},
    createdAt: t(at),
    ...e,
  }) as PaymentEventView;

describe('attemptsFrom', () => {
  it('rebuilds a flaky payment’s three attempts and the backoff between them', () => {
    const payment = {
      status: 'SUCCEEDED',
      createdAt: t(0),
      processedAt: t(5_000),
    } as PaymentView;
    const events = [
      event(1, 0, { type: 'payment.created' as never, toStatus: 'PENDING' as never }),
      event(2, 40, {
        type: 'payment.status_changed' as never,
        fromStatus: 'PENDING' as never,
        toStatus: 'PROCESSING' as never,
      }),
      event(3, 640, {
        type: 'payment.attempt_failed' as never,
        metadata: {
          attempt: 1,
          code: 'processing_error',
          startedAt: t(40),
          durationMs: 600,
          retryAt: t(1_500),
        },
      }),
      event(4, 2_300, {
        type: 'payment.attempt_failed' as never,
        metadata: {
          attempt: 2,
          code: 'processing_error',
          startedAt: t(1_510),
          durationMs: 790,
          retryAt: t(4_000),
        },
      }),
      event(5, 5_000, {
        type: 'payment.status_changed' as never,
        fromStatus: 'PROCESSING' as never,
        toStatus: 'SUCCEEDED' as never,
        metadata: { attempt: 3, startedAt: t(4_010), durationMs: 990 },
      }),
    ];
    const { attempts, pickedUp, end } = attemptsFrom(
      payment,
      events,
      Date.parse(t(9_000)),
    );
    expect(pickedUp).toBe(Date.parse(t(40)));
    expect(end).toBe(Date.parse(t(5_000)));
    expect(attempts.map((a) => [a.n, a.outcome, a.end - a.start])).toEqual([
      [1, 'retried', 600],
      [2, 'retried', 790],
      [3, 'approved', 990],
    ]);
  });

  it('shows the attempt in flight for a payment still processing', () => {
    const payment = {
      status: 'PROCESSING',
      createdAt: t(0),
      processedAt: null,
    } as PaymentView;
    const events = [
      event(1, 0, { type: 'payment.created' as never, toStatus: 'PENDING' as never }),
      event(2, 30, {
        type: 'payment.status_changed' as never,
        fromStatus: 'PENDING' as never,
        toStatus: 'PROCESSING' as never,
      }),
    ];
    const { attempts } = attemptsFrom(payment, events, Date.parse(t(1_030)));
    expect(attempts).toEqual([expect.objectContaining({ n: 1, outcome: 'running' })]);
    expect(attempts[0]!.end - attempts[0]!.start).toBe(1_000);
  });
});
