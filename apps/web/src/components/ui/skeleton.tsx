import { cn } from '@/lib/utils';

/** Placeholder shaped like the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-[10px] bg-sunken', className)}
    />
  );
}
