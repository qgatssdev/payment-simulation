import type { ReactNode } from 'react';

// Page title and one line on what the page shows, as on every top-level page.
export default function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-ink-2">{description}</p>
      </div>
      {action}
    </header>
  );
}
