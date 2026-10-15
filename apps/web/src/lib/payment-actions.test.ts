import { PaymentStatus } from '@payment-sim/shared';
import { actionsFor } from './payment-actions';

const enabled = (status: PaymentStatus) =>
  actionsFor(status)
    .filter((a) => a.enabled)
    .map((a) => a.to);

describe('actionsFor', () => {
  it.each([
    [PaymentStatus.PENDING, [PaymentStatus.CANCELLED]],
    [PaymentStatus.PROCESSING, []],
    [PaymentStatus.SUCCEEDED, [PaymentStatus.REFUNDED]],
    [PaymentStatus.FAILED, []],
    [PaymentStatus.CANCELLED, []],
    [PaymentStatus.REFUNDED, []],
  ])('%s offers %j', (status, expected) => {
    expect(enabled(status)).toEqual(expected);
  });

  it('always lists both actions, with a reason when unavailable', () => {
    const actions = actionsFor(PaymentStatus.FAILED);
    expect(actions.map((a) => a.label)).toEqual(['Cancel payment', 'Refund payment']);
    expect(actions.every((a) => a.unavailableReason.length > 0)).toBe(true);
  });
});
