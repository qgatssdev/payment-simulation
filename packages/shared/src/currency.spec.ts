import { formatMoney, isSupportedCurrency, toMajorUnits, toMinorUnits } from './currency';

describe('currency helpers', () => {
  it('converts between minor and major units using the currency exponent', () => {
    expect(toMajorUnits(150_050, 'NGN')).toBe(1500.5);
    expect(toMinorUnits(1500.5, 'NGN')).toBe(150_050);
    expect(toMajorUnits(1500, 'JPY')).toBe(1500);
    expect(toMinorUnits(1500, 'JPY')).toBe(1500);
  });

  it('rounds away float noise when converting to minor units', () => {
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
  });

  it('formats with the right number of decimals', () => {
    expect(formatMoney(123_456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
  });

  it('recognises supported currencies only', () => {
    expect(isSupportedCurrency('NGN')).toBe(true);
    expect(isSupportedCurrency('ngn')).toBe(false);
    expect(isSupportedCurrency('toString')).toBe(false);
  });
});
