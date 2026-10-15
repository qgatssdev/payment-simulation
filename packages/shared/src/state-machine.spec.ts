import { PAYMENT_STATUSES, PaymentStatus } from './payment-status';
import type { TransitionActor } from './state-machine';
import {
  CLIENT_SETTABLE_STATUSES,
  allowedTransitions,
  canTransition,
  findTransition,
  isTerminal,
} from './state-machine';

const { PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELLED, REFUNDED } = PaymentStatus;

// Written out independently of PAYMENT_TRANSITIONS so the test pins the intended lifecycle.
const EXPECTED: ReadonlyArray<[PaymentStatus, PaymentStatus, TransitionActor]> = [
  [PENDING, PROCESSING, 'system'],
  [PENDING, CANCELLED, 'client'],
  [PROCESSING, SUCCEEDED, 'system'],
  [PROCESSING, FAILED, 'system'],
  [SUCCEEDED, REFUNDED, 'client'],
];

const ACTORS: TransitionActor[] = ['system', 'client'];

describe('payment state machine', () => {
  const cases = PAYMENT_STATUSES.flatMap((from) =>
    PAYMENT_STATUSES.flatMap((to) => ACTORS.map((actor) => [from, to, actor] as const)),
  );

  it.each(cases)('%s → %s by %s', (from, to, actor) => {
    const expected = EXPECTED.some(([f, t, a]) => f === from && t === to && a === actor);
    expect(canTransition(from, to, actor)).toBe(expected);
  });

  it('never allows a self-transition', () => {
    for (const status of PAYMENT_STATUSES) {
      expect(findTransition(status, status)).toBeUndefined();
    }
  });

  it('lists the allowed next statuses per actor', () => {
    expect(allowedTransitions(PENDING, 'system')).toEqual([PROCESSING]);
    expect(allowedTransitions(PENDING, 'client')).toEqual([CANCELLED]);
    expect(allowedTransitions(PROCESSING, 'system')).toEqual([SUCCEEDED, FAILED]);
    expect(allowedTransitions(PROCESSING, 'client')).toEqual([]);
    expect(allowedTransitions(SUCCEEDED, 'client')).toEqual([REFUNDED]);
  });

  it('only exposes cancel and refund to clients', () => {
    expect([...CLIENT_SETTABLE_STATUSES].sort()).toEqual([CANCELLED, REFUNDED].sort());
  });

  it.each([
    [FAILED, true],
    [CANCELLED, true],
    [REFUNDED, true],
    [PENDING, false],
    [PROCESSING, false],
    [SUCCEEDED, false],
  ])('isTerminal(%s) is %s', (status, terminal) => {
    expect(isTerminal(status)).toBe(terminal);
  });
});
