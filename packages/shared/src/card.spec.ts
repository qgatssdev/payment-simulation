import {
  CardBrand,
  detectCardBrand,
  isCardExpired,
  luhnCheck,
  normalizeCardNumber,
} from './card';
import { findTestCard, TEST_CARDS } from './test-cards';

describe('luhnCheck', () => {
  it.each([
    '4242424242424242',
    '5555555555554444',
    '378282246310005',
    '5061460410120223210',
  ])('accepts %s', (n) => expect(luhnCheck(n)).toBe(true));

  it.each(['4242424242424241', '1234567812345678', '', '4242-4242', 'abcd'])(
    'rejects %p',
    (n) => expect(luhnCheck(n)).toBe(false),
  );
});

describe('normalizeCardNumber', () => {
  it('strips spaces and dashes', () => {
    expect(normalizeCardNumber(' 4242 4242-4242 4242 ')).toBe('4242424242424242');
  });
});

describe('detectCardBrand', () => {
  it.each([
    ['4242424242424242', CardBrand.VISA],
    ['5555555555554444', CardBrand.MASTERCARD],
    ['2223003122003222', CardBrand.MASTERCARD],
    ['378282246310005', CardBrand.AMEX],
    ['5061460410120223210', CardBrand.VERVE],
    ['6500000000000000', CardBrand.VERVE],
    ['9999999999999995', CardBrand.UNKNOWN],
  ])('%s is %s', (n, brand) => expect(detectCardBrand(n)).toBe(brand));
});

describe('isCardExpired', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it.each([
    [10, 2026, false],
    [11, 2026, false],
    [1, 2027, false],
    [9, 2026, true],
    [12, 2025, true],
  ])('%i/%i → expired=%s', (month, year, expired) => {
    expect(isCardExpired(month, year, now)).toBe(expired);
  });
});

describe('TEST_CARDS', () => {
  it.each(TEST_CARDS.map((c) => [c.label, c] as const))(
    '%s is a valid card of its declared brand',
    (_label, card) => {
      expect(luhnCheck(card.number)).toBe(true);
      expect(detectCardBrand(card.number)).toBe(card.brand);
    },
  );

  it('has unique numbers', () => {
    const numbers = TEST_CARDS.map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('finds cards by number', () => {
    expect(findTestCard('4242424242424242')?.outcome).toEqual({ kind: 'succeed' });
    expect(findTestCard('4111111111111111')).toBeUndefined();
  });
});
