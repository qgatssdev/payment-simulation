import type { Currency } from '@payment-sim/shared';
import { formatMoney } from '@payment-sim/shared';

export { formatMoney };

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
