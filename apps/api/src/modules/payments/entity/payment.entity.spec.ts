import { PaymentStatus } from '@payment-sim/shared';
import { Payment } from './payment.entity';

const NOW = new Date('2026-10-15T12:00:00Z');

function payment(status: PaymentStatus): Payment {
  const p = new Payment();
  p.status = status;
  p.processedAt = null;
  return p;
}

describe('Payment.transitionTo', () => {
  it('applies a legal transition and reports what changed', () => {
    const p = payment(PaymentStatus.PENDING);
    const result = p.transitionTo(PaymentStatus.CANCELLED, 'client', NOW);
    expect(result.getValue()).toEqual({ from: 'PENDING', to: 'CANCELLED' });
    expect(p.status).toBe(PaymentStatus.CANCELLED);
    expect(p.processedAt).toBeNull();
  });

  it.each([PaymentStatus.SUCCEEDED, PaymentStatus.FAILED])(
    'stamps processedAt when processing ends in %s',
    (to) => {
      const p = payment(PaymentStatus.PROCESSING);
      p.transitionTo(to, 'system', NOW);
      expect(p.processedAt).toBe(NOW);
    },
  );

  it('rejects an illegal transition without mutating, listing the alternatives', () => {
    const p = payment(PaymentStatus.PENDING);
    const result = p.transitionTo(PaymentStatus.SUCCEEDED, 'system', NOW);
    expect(result.errorValue()).toEqual({
      from: 'PENDING',
      to: 'SUCCEEDED',
      allowed: ['PROCESSING'],
    });
    expect(p.status).toBe(PaymentStatus.PENDING);
  });

  it('rejects a legal edge taken by the wrong actor', () => {
    const p = payment(PaymentStatus.PENDING);
    expect(p.transitionTo(PaymentStatus.PROCESSING, 'client', NOW).errorValue()).toEqual({
      from: 'PENDING',
      to: 'PROCESSING',
      allowed: ['CANCELLED'],
    });
  });
});
