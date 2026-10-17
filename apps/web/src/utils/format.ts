import type { Currency } from '@payment-sim/shared';
import { CURRENCY_EXPONENTS, toMajorUnits } from '@payment-sim/shared';

const moneyFormats = new Map<Currency, Intl.NumberFormat>();

/** ₦2,500.00, £975.14: the currency's own symbol, its own minor-unit digits, from minor units. */
export function formatMoney(amountMinor: number, currency: Currency): string {
  let format = moneyFormats.get(currency);
  if (!format) {
    const digits = CURRENCY_EXPONENTS[currency];
    format = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFormats.set(currency, format);
  }
  return format.format(toMajorUnits(amountMinor, currency));
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

export function formatVolume(volume: Partial<Record<Currency, number>>): string[] {
  return Object.entries(volume).map(([currency, amount]) =>
    formatMoney(amount ?? 0, currency as Currency),
  );
}

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Large amounts shortened for headline tiles: ₦14.3M, £15.8K. Exact values live in tables. */
export function formatMoneyCompact(amountMinor: number, currency: Currency): string {
  const major = toMajorUnits(amountMinor, currency);
  if (Math.abs(major) < 10_000)
    return formatMoney(
      Math.round(major) * 10 ** CURRENCY_EXPONENTS[currency],
      currency,
    ).replace(/\.00$/, '');
  const symbol = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value;
  return `${symbol ?? `${currency} `}${compact.format(major)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Whole percent for headlines; averages and rates are never shown with stray decimals. */
export function formatPercentWhole(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
}

/** 840 ms, 1.6 s, 2 min: one decimal only below ten seconds. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 120_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

/** "12 s ago", "3 min ago", "yesterday". */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 5) return 'just now';
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatClock(iso: string, withDay = false): string {
  return (withDay ? dayTime : timeOnly).format(new Date(iso));
}
