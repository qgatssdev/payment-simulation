import { DEFAULT_VALUES } from '@/components/create-payment-form';
import type { PaymentFormValues } from './payment-form';
import { paymentFormResolver, toCreatePaymentBody, toMinorAmount } from './payment-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const values = (
  overrides: Partial<PaymentFormValues> = {},
  card = {},
): PaymentFormValues => ({
  ...DEFAULT_VALUES,
  ...overrides,
  card: { ...DEFAULT_VALUES.card, ...card },
});

const resolve = (v: PaymentFormValues) =>
  paymentFormResolver(v, undefined, { fields: {}, shouldUseNativeValidation: false });

describe('toMinorAmount', () => {
  it.each([
    ['2500.50', 'NGN', 250_050],
    ['2500', 'USD', 250_000],
    [' 0.1 ', 'EUR', 10],
    ['1500', 'JPY', 1500],
  ] as const)('%s %s → %d minor units', (amount, currency, expected) => {
    expect(toMinorAmount(amount, currency)).toBe(expected);
  });

  it.each([
    ['10.555', 'USD'],
    ['1500.5', 'JPY'],
    ['-5', 'USD'],
    ['1e3', 'USD'],
    ['', 'USD'],
    ['abc', 'USD'],
  ] as const)('refuses %p in %s instead of rounding it', (amount, currency) => {
    expect(toMinorAmount(amount, currency)).toBeNaN();
  });
});

describe('toCreatePaymentBody', () => {
  it('builds the API body: minor units, numeric expiry, optional fields omitted', () => {
    expect(
      toCreatePaymentBody(values({ description: '  ' }, { holderName: '' })),
    ).toEqual({
      amount: 250_000,
      currency: 'NGN',
      customerEmail: 'ada@example.com',
      description: undefined,
      card: {
        number: DEFAULT_VALUES.card.number,
        expMonth: 12,
        expYear: Number(DEFAULT_VALUES.card.expYear),
        cvc: '123',
        holderName: undefined,
      },
    });
  });
});

describe('paymentFormResolver (the API’s own DTO rules)', () => {
  it('accepts the defaults', async () => {
    expect((await resolve(values())).errors).toEqual({});
  });

  it('puts card errors on the nested fields', async () => {
    const { errors } = await resolve(
      values({}, { number: '4242424242424241', cvc: '1' }),
    );
    expect(errors.card?.number?.message).toBe('card number is invalid');
    expect(errors.card?.cvc?.message).toBe('cvc must be 3 or 4 digits');
  });

  it('rejects an expired card on the expiry year', async () => {
    const { errors } = await resolve(values({}, { expMonth: '1', expYear: '2020' }));
    expect(errors.card?.expYear).toBeDefined();
  });

  it('explains amount errors in the units the user typed', async () => {
    expect(
      (await resolve(values({ amount: '10.555', currency: 'USD' }))).errors.amount
        ?.message,
    ).toBe('Enter an amount above zero with at most 2 decimals');
    expect(
      (await resolve(values({ amount: '10.5', currency: 'JPY' }))).errors.amount?.message,
    ).toBe('Enter a whole amount of JPY');
  });

  it('validates the email like the API does', async () => {
    expect(
      (await resolve(values({ customerEmail: 'nope' }))).errors.customerEmail,
    ).toBeDefined();
  });
});
