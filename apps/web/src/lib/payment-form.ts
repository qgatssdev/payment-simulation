import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import type { Currency } from '@payment-sim/shared';
import { CURRENCY_EXPONENTS, CreatePaymentDto } from '@payment-sim/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';
import type { CreatePaymentBody } from './api';

/** What the form edits: human units and strings, as typed. */
export interface PaymentFormValues {
  amount: string;
  currency: Currency;
  customerEmail: string;
  description: string;
  card: {
    number: string;
    expMonth: string;
    expYear: string;
    cvc: string;
    holderName: string;
  };
}

/**
 * Major units ("2500.50") to the API's integer minor units, refusing more decimals than the
 * currency has rather than silently rounding someone's money.
 */
export function toMinorAmount(amount: string, currency: Currency): number {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  const minor = Number(trimmed) * 10 ** CURRENCY_EXPONENTS[currency];
  const rounded = Math.round(minor);
  return Math.abs(minor - rounded) < 1e-6 ? rounded : Number.NaN;
}

export function toCreatePaymentBody(values: PaymentFormValues): CreatePaymentBody {
  const optional = (s: string) => (s.trim() === '' ? undefined : s.trim());
  return {
    amount: toMinorAmount(values.amount, values.currency),
    currency: values.currency,
    customerEmail: values.customerEmail,
    description: optional(values.description),
    card: {
      number: values.card.number,
      expMonth: Number(values.card.expMonth),
      expYear: Number(values.card.expYear),
      cvc: values.card.cvc,
      holderName: optional(values.card.holderName),
    },
  };
}

const validateDto = classValidatorResolver(CreatePaymentDto);

/**
 * Validates with the same class-validator DTO the API uses, on the body the form will send.
 * Field paths match (amount, card.number, ...), so errors land on the right inputs; only the
 * amount message is reworded, because the user types major units, not minor ones.
 */
export const paymentFormResolver: Resolver<PaymentFormValues> = async (
  values,
  context,
  options,
) => {
  // The resolver is typed for the DTO's form; this form's values map onto it field for field.
  const result = await validateDto(
    toCreatePaymentBody(values),
    context,
    options as never,
  );
  const errors = result.errors as FieldErrors<PaymentFormValues>;
  if (Object.keys(errors).length === 0) return { values, errors: {} };

  if (errors.amount) {
    const digits = CURRENCY_EXPONENTS[values.currency];
    errors.amount = {
      type: 'amount',
      message:
        digits === 0
          ? `Enter a whole amount of ${values.currency}`
          : `Enter an amount above zero with at most ${digits} decimals`,
    };
  }
  return { values: {}, errors };
};
