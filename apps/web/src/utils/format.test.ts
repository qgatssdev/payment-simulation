import { formatMoney, formatMoneyCompact, formatMs, formatPercentWhole } from './format';

describe('format', () => {
  it('formats money from minor units with the currency’s own symbol and digits', () => {
    expect(formatMoney(123_456, 'NGN')).toBe('₦1,234.56');
    expect(formatMoney(97_514, 'GBP')).toBe('£975.14');
    expect(formatMoney(1_500, 'JPY')).toBe('¥1,500');
  });

  it('shortens large headline amounts and rounds small ones to whole units', () => {
    expect(formatMoneyCompact(214_300_000, 'NGN')).toBe('₦2.1M');
    expect(formatMoneyCompact(240_037, 'GBP')).toBe('£2,400');
  });

  it('never shows stray decimals on durations and rates', () => {
    expect(formatMs(840.4)).toBe('840 ms');
    expect(formatMs(1_649)).toBe('1.6 s');
    expect(formatMs(28_400)).toBe('28 s');
    expect(formatMs(240_000)).toBe('4 min');
    expect(formatPercentWhole(0.8654)).toBe('87%');
    expect(formatPercentWhole(null)).toBe('—');
  });
});
