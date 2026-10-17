'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** Copies `value`; the icon confirms for a moment. Announces the result to screen readers. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What is being copied, for the accessible name: "Copy payment ID". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? `${label}: copied` : label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className={cn(
        'pressable inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-[var(--status-succeeded)]" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
