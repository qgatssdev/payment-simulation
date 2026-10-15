export enum CardBrand {
  VISA = 'visa',
  MASTERCARD = 'mastercard',
  AMEX = 'amex',
  VERVE = 'verve',
  UNKNOWN = 'unknown',
}

export function normalizeCardNumber(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function luhnCheck(cardNumber: string): boolean {
  if (!/^\d+$/.test(cardNumber)) return false;
  let sum = 0;
  let double = false;
  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = cardNumber.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

// Verve is checked before Mastercard/Visa because its BIN ranges are the most specific.
const BRAND_PATTERNS: ReadonlyArray<[CardBrand, RegExp]> = [
  [CardBrand.VERVE, /^(506(0|1)|507[89]|6500)/],
  [CardBrand.AMEX, /^3[47]/],
  [CardBrand.MASTERCARD, /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/],
  [CardBrand.VISA, /^4/],
];

export function detectCardBrand(cardNumber: string): CardBrand {
  const match = BRAND_PATTERNS.find(([, pattern]) => pattern.test(cardNumber));
  return match ? match[0] : CardBrand.UNKNOWN;
}

/** A card is valid through the last day of its expiry month. */
export function isCardExpired(
  expMonth: number,
  expYear: number,
  now = new Date(),
): boolean {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return expYear < year || (expYear === year && expMonth < month);
}
