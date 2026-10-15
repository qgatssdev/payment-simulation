import { PaymentStatus } from './payment-status';

/**
 * Who may trigger a transition. `system` edges are driven by the payment worker;
 * `client` edges are the only ones the public PATCH endpoint (and the UI) may request.
 */
export type TransitionActor = 'system' | 'client';

export interface Transition {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
  readonly actor: TransitionActor;
}

/** The single source of truth for the payment lifecycle, used by the API and the UI. */
export const PAYMENT_TRANSITIONS: readonly Transition[] = [
  { from: PaymentStatus.PENDING, to: PaymentStatus.PROCESSING, actor: 'system' },
  { from: PaymentStatus.PENDING, to: PaymentStatus.CANCELLED, actor: 'client' },
  { from: PaymentStatus.PROCESSING, to: PaymentStatus.SUCCEEDED, actor: 'system' },
  { from: PaymentStatus.PROCESSING, to: PaymentStatus.FAILED, actor: 'system' },
  { from: PaymentStatus.SUCCEEDED, to: PaymentStatus.REFUNDED, actor: 'client' },
];

export function findTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): Transition | undefined {
  return PAYMENT_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  actor: TransitionActor,
): boolean {
  return findTransition(from, to)?.actor === actor;
}

export function allowedTransitions(
  from: PaymentStatus,
  actor: TransitionActor,
): PaymentStatus[] {
  return PAYMENT_TRANSITIONS.filter((t) => t.from === from && t.actor === actor).map(
    (t) => t.to,
  );
}

/** Statuses a client may request via PATCH /payments/:id/status. */
export const CLIENT_SETTABLE_STATUSES: readonly PaymentStatus[] = [
  ...new Set(PAYMENT_TRANSITIONS.filter((t) => t.actor === 'client').map((t) => t.to)),
];

/** A status with no outgoing edges: the payment will never change again. */
export function isTerminal(status: PaymentStatus): boolean {
  return !PAYMENT_TRANSITIONS.some((t) => t.from === status);
}
