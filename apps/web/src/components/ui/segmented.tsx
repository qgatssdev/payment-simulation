'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A small radio group drawn as a segmented control (time ranges, theme, run sizes). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-control bg-sunken p-1', className)}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.title}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'pressable inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium tabular-nums',
              size === 'sm'
                ? 'h-7 min-w-8 px-2 text-xs'
                : 'h-8 min-w-10 px-3 text-[13px]',
              checked
                ? 'bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
