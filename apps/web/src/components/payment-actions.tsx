'use client';

import type { PaymentView } from '@payment-sim/shared';
import { ErrorCode, PaymentStatus } from '@payment-sim/shared';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { actionsFor } from '@/lib/payment-actions';
import { useUpdateStatus } from '@/lib/queries';
import { STATUS_LABEL } from './status-badge';
import { Button } from './ui/button';
import { TextField } from './ui/field';

/**
 * Cancel / refund, offered only when the shared state machine allows them, and sent with the
 * version shown (If-Match) so a payment that changed meanwhile is refused instead of
 * overwritten.
 */
export function PaymentActions({ payment }: { payment: PaymentView }) {
  const [reason, setReason] = useState('');
  const update = useUpdateStatus(payment);
  const hintId = useId();
  const actions = actionsFor(payment.status);
  const anyEnabled = actions.some((a) => a.enabled);

  function apply(to: PaymentView['status'], label: string) {
    update.mutate(
      { status: to, reason: reason.trim() || undefined },
      {
        onSuccess: (updated) => {
          toast.success(`${label.replace(' payment', '')} done`, {
            description: `Payment is now ${STATUS_LABEL[updated.status]}`,
          });
          setReason('');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === ErrorCode.PRECONDITION_FAILED) {
            notifyError(
              error,
              'The payment changed while you were looking; showing the latest',
            );
          } else {
            notifyError(error, `Could not ${label.toLowerCase()}`);
          }
        },
      },
    );
  }

  return (
    <div className="space-y-3">
      {anyEnabled && (
        <TextField
          label="Reason (optional)"
          placeholder="e.g. Customer changed their mind"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
