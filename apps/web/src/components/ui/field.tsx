import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export const controlClasses =
  'h-10 w-full rounded-control bg-sunken px-3.5 text-sm text-ink placeholder:text-ink-3 ' +
  'transition-[box-shadow,background-color] duration-150 ' +
  'hover:bg-[color-mix(in_oklab,var(--sunken),var(--ink)_4%)] ' +
  'focus-visible:bg-panel focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--brand)] ' +
  'aria-[invalid=true]:shadow-[0_0_0_2px_var(--status-failed)]';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
}

/** Label, control, hint and error wired together, so the error is announced with the field. */
export const TextField = forwardRef<
  HTMLInputElement,
  FieldProps & InputHTMLAttributes<HTMLInputElement>
>(function TextField({ label, error, hint, className, hideLabel, ...props }, ref) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn(
          'mb-1.5 block text-[13px] font-medium text-ink-2',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={controlClasses}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-critical-ink">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  FieldProps & SelectHTMLAttributes<HTMLSelectElement>
>(function SelectField({ label, error, className, children, hideLabel, ...props }, ref) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn(
          'mb-1.5 block text-[13px] font-medium text-ink-2',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          className={cn(controlClasses, 'appearance-none pr-9')}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3"
        />
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-critical-ink">{error}</p>}
    </div>
  );
});
