import { CreatePaymentDto } from '@payment-sim/shared';
import { plainToInstance } from 'class-transformer';
import { fingerprintCreatePayment } from './request-fingerprint';

const dto = (
  overrides: Record<string, unknown> = {},
  card: Record<string, unknown> = {},
) =>
  plainToInstance(CreatePaymentDto, {
    amount: 5000,
    currency: 'usd',
    customerEmail: 'Ada@Example.com',
    card: {
      number: '4242 4242 4242 4242',
      expMonth: 12,
      expYear: 2030,
      cvc: '123',
      ...card,
    },
    ...overrides,
  });

describe('fingerprintCreatePayment', () => {
  const base = fingerprintCreatePayment(dto());

  it('is a hex SHA-256', () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores formatting and the CVC', () => {
    expect(
      fingerprintCreatePayment(
        dto(
          { currency: 'USD', customerEmail: 'ada@example.com' },
          { number: '4242424242424242', cvc: '999' },
        ),
      ),
    ).toBe(base);
  });

  it.each([
    ['amount', dto({ amount: 5001 })],
    ['currency', dto({ currency: 'EUR' })],
    ['email', dto({ customerEmail: 'grace@example.com' })],
    ['description', dto({ description: 'gift' })],
    ['card', dto({}, { number: '5555555555554444' })],
    ['expiry', dto({}, { expYear: 2031 })],
  ])('changes when the %s changes', (_field, changed) => {
    expect(fingerprintCreatePayment(changed)).not.toBe(base);
  });

  it('cannot be reversed to the card number: only brand and last4 go in', () => {
    // Two cards sharing brand, last4 and expiry are indistinguishable by design.
    expect(fingerprintCreatePayment(dto({}, { number: '4000056655664242' }))).toBe(base);
  });
});
