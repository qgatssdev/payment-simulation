import type { ClassConstructor } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaymentStatus } from '../payment-status';
import { CreatePaymentDto, MAX_PAYMENT_AMOUNT } from './create-payment.dto';
import { ListPaymentsQueryDto } from './list-payments-query.dto';
import { PaymentIdParamDto } from './payment-id-param.dto';
import { UpdatePaymentStatusDto } from './update-payment-status.dto';

/** Same pipeline the API's validate middleware runs: transform, then whitelist-validate. */
function check<T extends object>(cls: ClassConstructor<T>, plain: unknown) {
  const instance = plainToInstance(cls, plain);
  const errors = validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });
  const flatten = (errs: typeof errors, prefix = ''): string[] =>
    errs.flatMap((e) => [
      ...(e.constraints ? [`${prefix}${e.property}`] : []),
      ...flatten(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  return { instance, fields: flatten(errors) };
}

const nextYear = new Date().getUTCFullYear() + 1;

const validPayment = () => ({
  amount: 250_000,
  currency: 'ngn',
  customerEmail: '  Ada@Example.COM ',
  description: '  Order #1001 ',
  card: { number: '4242 4242 4242 4242', expMonth: 12, expYear: nextYear, cvc: '123' },
});

describe('CreatePaymentDto', () => {
  it('accepts a valid payment and normalises its fields', () => {
    const { instance, fields } = check(CreatePaymentDto, validPayment());
    expect(fields).toEqual([]);
    expect(instance.currency).toBe('NGN');
    expect(instance.customerEmail).toBe('ada@example.com');
    expect(instance.description).toBe('Order #1001');
    expect(instance.card.number).toBe('4242424242424242');
  });

  it.each([
    ['amount', { amount: 10.5 }],
    ['amount', { amount: 0 }],
    ['amount', { amount: MAX_PAYMENT_AMOUNT + 1 }],
    ['amount', { amount: '100' }],
    ['currency', { currency: 'BTC' }],
    ['customerEmail', { customerEmail: 'not-an-email' }],
    ['description', { description: 'x'.repeat(256) }],
  ])('rejects an invalid %s', (field, override) => {
    expect(check(CreatePaymentDto, { ...validPayment(), ...override }).fields).toContain(
      field,
    );
  });

  it.each([
    ['card.number', { number: '4242424242424241' }],
    ['card.number', { number: '4242' }],
    ['card.expMonth', { expMonth: 13 }],
    ['card.expYear', { expYear: 2020 }],
    ['card.cvc', { cvc: '12a' }],
  ])('rejects an invalid %s', (field, override) => {
    const body = validPayment();
    expect(
      check(CreatePaymentDto, { ...body, card: { ...body.card, ...override } }).fields,
    ).toContain(field);
  });

  it('requires the card', () => {
    const { card: _card, ...rest } = validPayment();
    expect(check(CreatePaymentDto, rest).fields).toContain('card');
  });

  it.each([['4242424242424242'], [[]], [null]])(
    'rejects a non-object card %p',
    (card) => {
      expect(check(CreatePaymentDto, { ...validPayment(), card }).fields).toContain(
        'card',
      );
    },
  );

  it('reports type-confused fields instead of crashing in transforms', () => {
    const body = validPayment();
    const { fields } = check(CreatePaymentDto, {
      ...body,
      currency: 840,
      customerEmail: 42,
      description: 7,
      card: { ...body.card, number: 4242424242424242, holderName: 1 },
    });
    expect(fields).toEqual(
      expect.arrayContaining([
        'currency',
        'customerEmail',
        'description',
        'card.number',
        'card.holderName',
      ]),
    );
  });

  it('reports a bad expMonth once, not as an expired card', () => {
    const body = validPayment();
    const { fields } = check(CreatePaymentDto, {
      ...body,
      card: { ...body.card, expMonth: 'twelve' },
    });
    expect(fields).toEqual(['card.expMonth']);
  });

  it('rejects unknown properties', () => {
    expect(
      check(CreatePaymentDto, { ...validPayment(), status: 'SUCCEEDED' }).fields,
    ).toContain('status');
  });
});

describe('UpdatePaymentStatusDto', () => {
  it.each([PaymentStatus.CANCELLED, PaymentStatus.REFUNDED])('accepts %s', (status) => {
    expect(
      check(UpdatePaymentStatusDto, { status, reason: ' customer asked ' }),
    ).toMatchObject({
      fields: [],
      instance: { status, reason: 'customer asked' },
    });
  });

  it('rejects a non-string reason', () => {
    expect(
      check(UpdatePaymentStatusDto, { status: PaymentStatus.CANCELLED, reason: 5 })
        .fields,
    ).toEqual(['reason']);
  });

  it.each([PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING, 'BOGUS'])(
    'rejects system-only or unknown status %s',
    (status) => {
      expect(check(UpdatePaymentStatusDto, { status }).fields).toEqual(['status']);
    },
  );
});

describe('ListPaymentsQueryDto', () => {
  it('coerces query-string values', () => {
    const { instance, fields } = check(ListPaymentsQueryDto, {
      limit: '50',
      currency: 'usd',
      status: 'FAILED',
      from: '2026-01-01T00:00:00Z',
    });
    expect(fields).toEqual([]);
    expect(instance).toMatchObject({ limit: 50, currency: 'USD', status: 'FAILED' });
  });

  it.each([
    ['limit', { limit: '0' }],
    ['limit', { limit: '101' }],
    ['limit', { limit: 'ten' }],
    ['status', { status: 'DONE' }],
    ['currency', { currency: 5 }],
    ['from', { from: 'yesterday' }],
  ])('rejects an invalid %s', (field, query) => {
    expect(check(ListPaymentsQueryDto, query).fields).toEqual([field]);
  });
});

describe('PaymentIdParamDto', () => {
  it('accepts a UUID v4', () => {
    expect(
      check(PaymentIdParamDto, { id: '6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70' }).fields,
    ).toEqual([]);
  });

  it('rejects anything else', () => {
    expect(check(PaymentIdParamDto, { id: '123' }).fields).toEqual(['id']);
  });
});
