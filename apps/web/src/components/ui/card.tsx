import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A panel: white (or dark) surface with a soft shadow. Panels never nest. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('panel min-w-0 p-5 sm:p-6', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-[13px] text-ink-2">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
