'use client';

import type { InsightsRange } from '@payment-sim/shared';
import { INSIGHT_RANGES } from '@payment-sim/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Segmented } from './ui/segmented';

const LABEL: Record<InsightsRange, string> = {
  '15m': '15m',
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
};
export const DEFAULT_RANGE: InsightsRange = '24h';

/** The time window, kept in the URL (?range=) so a view can be shared and reloaded. */
export function useRange(): [InsightsRange, (r: InsightsRange) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get('range');
  const range = (INSIGHT_RANGES as readonly string[]).includes(value ?? '')
    ? (value as InsightsRange)
    : DEFAULT_RANGE;
  const set = (r: InsightsRange) => {
    const next = new URLSearchParams(params);
    if (r === DEFAULT_RANGE) next.delete('range');
    else next.set('range', r);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [range, set];
}

export function RangePicker({
  range,
  onChange,
}: {
  range: InsightsRange;
  onChange: (r: InsightsRange) => void;
}) {
  return (
    <Segmented
      label="Time range"
      value={range}
      onChange={onChange}
      options={INSIGHT_RANGES.map((r) => ({ value: r, label: LABEL[r] }))}
    />
  );
}
