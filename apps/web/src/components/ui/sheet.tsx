'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

/**
 * A modal sheet: slides in from the right on a laptop and up from the bottom on a phone.
 * Escape and the scrim close it; focus moves in on open and returns on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-[var(--scrim)] backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          'absolute inset-x-0 bottom-0 flex max-h-[92dvh] animate-sheet-up flex-col rounded-t-[28px] bg-panel shadow-float outline-none ' +
          'sm:inset-y-3 sm:right-3 sm:left-auto sm:max-h-none sm:w-[560px] sm:animate-sheet-in sm:rounded-[28px]'
        }
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-[-0.015em] text-ink"
            >
              {title}
            </h2>
            {description && <p className="mt-1 text-[13px] text-ink-2">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pressable -mt-1 -mr-2 flex size-9 items-center justify-center rounded-xl text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <X className="size-4.5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">{children}</div>
      </div>
    </div>
  );
}
