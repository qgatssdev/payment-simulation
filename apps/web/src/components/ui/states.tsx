import type { LucideIcon } from 'lucide-react';
import { RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { API_URL } from '@/config';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api';
import { Button } from './button';

/** Nothing here yet: says why, and offers the way forward. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="flex size-11 items-center justify-center rounded-2xl bg-sunken text-ink-3">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** What went wrong, the API's code and request id, and how to recover. */
export function ErrorState({
  error,
  title,
  onRetry,
  className,
}: {
  error: unknown;
  title: string;
  onRetry?: () => void;
  className?: string;
}) {
  const api = error instanceof ApiError ? error : undefined;
  const offline = api?.code === 'NETWORK_ERROR';
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center px-6 py-10 text-center', className)}
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-sunken text-critical-ink">
        {offline ? (
          <WifiOff className="size-5" aria-hidden />
        ) : (
          <TriangleAlert className="size-5" aria-hidden />
        )}
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-[13px] text-ink-2">
        {offline ? (
          <>
            The API at <code className="font-mono text-xs">{API_URL}</code> is not
            answering. Start it with <code className="font-mono text-xs">pnpm dev</code>,
            then try again.
          </>
        ) : (
          ((error as Error)?.message ?? 'Something went wrong.')
        )}
      </p>
      {api && !offline && (
        <p className="mt-2 font-mono text-[11px] text-ink-3">
          {api.code} ({api.status}){api.requestId && ` · request ${api.requestId}`}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}
