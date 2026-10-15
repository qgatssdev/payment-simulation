import { toast } from 'sonner';
import { ApiError } from './api';

/** Show an API failure with what a developer needs to find it in the logs. */
export function notifyError(error: unknown, title?: string): void {
  if (error instanceof ApiError) {
    const reference = [error.code, error.requestId && `request ${error.requestId}`]
      .filter(Boolean)
      .join(' · ');
    toast.error(title ?? error.message, {
      description: title ? `${error.message} (${reference})` : reference,
    });
    return;
  }
  toast.error(title ?? 'Something went wrong', {
    description: error instanceof Error ? error.message : undefined,
  });
}
