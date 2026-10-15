import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 disabled:hover:brightness-100',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  danger: 'border border-critical/40 bg-surface text-critical-ink hover:bg-critical/10',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
};

/** Button styling, also for links that should look like buttons (never nest the two). */
export function buttonClasses(variant: Variant = 'primary', className?: string): string {
  return cn(
    'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClasses(variant, className)} {...props} />;
}
