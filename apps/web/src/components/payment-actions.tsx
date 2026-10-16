'use client';

import type { PaymentView } from '@payment-sim/shared';
import { ErrorCode, PaymentStatus } from '@payment-sim/shared';
import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { actionsFor } from '@/lib/payment-actions';
import { useUpdateStatus } from '@/lib/queries';
import { STATUS_LABEL } from '@/lib/vocabulary';
import { Button } from './ui/button';
import { TextField } from './ui/field';

/** What went wrong, in the product's words, with the API's code and request id. */
export function explainActionError(
  error: unknown,
  label: string,
): { title: string; detail: string } {
  const verb = label.replace(' payment', '').toLowerCase();
  if (error instanceof ApiError) {
    const ref = `${error.code} · ${error.status}${error.requestId ? ` · request ${error.requestId}` : ''}`;
    if (error.code === ErrorCode.PRECONDITION_FAILED) {
      return {
        title: `This payment changed since you loaded it (412).`,
        detail: `The latest version is now shown. Check it, then ${verb} again if it still applies. ${ref}`,
      };
    }
    if (error.code === ErrorCode.INVALID_STATE_TRANSITION) {
      return {
        title: `This payment can no longer be ${verb === 'cancel' ? 'cancelled' : 'refunded'} (409).`,
        detail: `Its status moved on before your request arrived. ${ref}`,
      };
    }
    if (error.code === 'NETWORK_ERROR') {
      return {
        title: 'The API did not answer.',
        detail: 'Nothing was changed. Check your connection and try again.',
      };
    }
    return { title: error.message, detail: ref };
  }
  return {
    title: `Could not ${verb} the payment.`,
    detail: error instanceof Error ? error.message : '',
  };
}

/**
 * Cancel / refund, offered only when the shared state machine allows them, and sent with the
 * version shown (If-Match) so a payment that changed meanwhile is refused instead of
 * overwritten.
 */
export function PaymentActions({ payment }: { payment: PaymentView }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const update = useUpdateStatus(payment);
  const hintId = useId();
  const actions = actionsFor(payment.status);
  const anyEnabled = actions.some((a) => a.enabled);

  function apply(to: PaymentView['status'], label: string) {
    setProblem(null);
    update.mutate(
      { status: to, reason: reason.trim() || undefined },
      {
        onSuccess: (updated) => {
          toast.success(`Payment ${STATUS_LABEL[updated.status].toLowerCase()}`, {
            description: reason.trim() ? `Reason: ${reason.trim()}` : undefined,
          });
          setReason('');
        },
        onError: (error) => setProblem(explainActionError(error, label)),
      },
    );
  }

  return (
    <div className="space-y-4">
      {anyEnabled && (
        <TextField
          label="Reason (optional)"
          placeholder="e.g. Customer changed their mind"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <Button
            key={action.to}
            variant={action.to === PaymentStatus.CANCELLED ? 'danger' : 'secondary'}
            disabled={!action.enabled || update.isPending}
            aria-describedby={action.enabled ? undefined : `${hintId}-${action.to}`}
            onClick={() => apply(action.to, action.label)}
          >
            {update.isPending && update.variables?.status === action.to
              ? 'Working…'
              : action.label}
          </Button>
        ))}
      </div>
      {actions
        .filter((a) => !a.enabled)
        .map((a) => (
          <p key={a.to} id={`${hintId}-${a.to}`} className="text-xs text-ink-3">
            {a.unavailableReason}.
          </p>
        ))}
      {problem && (
        <div role="alert" className="flex gap-2.5 rounded-xl bg-sunken p-3 text-[13px]">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-critical-ink"
            aria-hidden
          />
          <p>
            <span className="font-medium text-ink">{problem.title}</span>{' '}
            <span className="text-ink-2">{problem.detail}</span>
          </p>
        </div>
      )}
    </div>
  );
}
