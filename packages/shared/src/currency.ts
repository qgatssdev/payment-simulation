/** ISO 4217 code → number of minor-unit digits. Amounts are always stored as integer minor units. */
export const CURRENCY_EXPONENTS = {
  NGN: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KES: 2,
  GHS: 2,
  ZAR: 2,
  JPY: 0,
} as const;

export type Currency = keyof typeof CURRENCY_EXPONENTS;

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENTS) as Currency[];

export function isSupportedCurrency(value: string): value is Currency {
  return Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function toMajorUnits(amountMinor: number, currency: Currency): number {
  return amountMinor / 10 ** CURRENCY_EXPONENTS[currency];
}

export function toMinorUnits(amountMajor: number, currency: Currency): number {
  return Math.round(amountMajor * 10 ** CURRENCY_EXPONENTS[currency]);
}

export function formatMoney(
  amountMinor: number,
  currency: Currency,
  locale = 'en-US',
): string {
  const digits = CURRENCY_EXPONENTS[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajorUnits(amountMinor, currency));
}
