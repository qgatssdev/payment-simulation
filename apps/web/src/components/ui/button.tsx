import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // The brand colour's main job: the one primary action on a screen.
  primary:
    'bg-brand text-on-brand shadow-brand hover:bg-brand-press disabled:shadow-none disabled:hover:bg-brand',
  secondary:
    'bg-sunken text-ink hover:bg-[color-mix(in_oklab,var(--sunken),var(--ink)_6%)]',
  danger:
    'bg-sunken text-critical-ink hover:bg-[color-mix(in_oklab,var(--sunken),var(--status-failed)_14%)]',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 rounded-[10px] px-3 text-[13px]',
  md: 'h-10 rounded-control px-4 text-sm',
  lg: 'h-12 rounded-[14px] px-5 text-[15px]',
};

/** Button styling, also for links that should look like buttons (never nest the two). */
export function buttonClasses(
  variant: Variant = 'primary',
  className?: string,
  size: Size = 'md',
): string {
  return cn(
    'pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none',
    'disabled:cursor-not-allowed disabled:opacity-45',
    SIZES[size],
    VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button type={type} className={buttonClasses(variant, className, size)} {...props} />
  );
}
