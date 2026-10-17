import type { PaymentStatus } from '@payment-sim/shared';
import {
  CLIENT_SETTABLE_STATUSES,
  PaymentStatus as Status,
  canTransition,
} from '@payment-sim/shared';

export interface StatusAction {
  to: PaymentStatus;
  label: string;
  /** Why it is unavailable, for the disabled button's description. */
  unavailableReason: string;
  enabled: boolean;
}

const COPY: Partial<Record<PaymentStatus, { label: string; when: string }>> = {
  [Status.CANCELLED]: {
    label: 'Cancel payment',
    when: 'Only pending payments can be cancelled',
  },
  [Status.REFUNDED]: {
    label: 'Refund payment',
    when: 'Only succeeded payments can be refunded',
  },
};

/**
 * The buttons a client may offer, straight from the shared state machine the API enforces:
 * the UI never offers a transition the server would reject as illegal.
 */
export function actionsFor(status: PaymentStatus): StatusAction[] {
  return CLIENT_SETTABLE_STATUSES.map((to) => ({
    to,
    label: COPY[to]?.label ?? `Move to ${to}`,
    unavailableReason: COPY[to]?.when ?? 'Not available from this status',
    enabled: canTransition(status, to, 'client'),
  }));
}
