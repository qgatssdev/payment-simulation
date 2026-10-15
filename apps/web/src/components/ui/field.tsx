import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

const control =
  'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ' +
  'aria-[invalid=true]:border-critical';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
}

/** Label, control, hint and error wired together, so the error is announced with the field. */
export const TextField = forwardRef<
  HTMLInputElement,
  FieldProps & InputHTMLAttributes<HTMLInputElement>
>(function TextField({ label, error, hint, className, ...props }, ref) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={control}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-critical-ink">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-ink-3">
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
>(function SelectField({ label, error, className, children, ...props }, ref) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(control, 'pr-8')}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-critical-ink">{error}</p>}
    </div>
  );
});
