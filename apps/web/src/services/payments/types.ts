import type { Currency, PaymentStatus } from '@payment-sim/shared';

// Response shapes (PaymentView, PaymentEventView…) come from @payment-sim/shared, the same
// types the API serialises. Only what the client sends is declared here.

export interface CreatePaymentPayload {
  amount: number;
  currency: Currency;
  customerEmail: string;
  description?: string;
  card: {
    number: string;
    expMonth: number;
    expYear: number;
    cvc: string;
    holderName?: string;
  };
}

// A type, not an interface, so it fits buildQueryParams' index signature.
export type PaymentsParams = {
  cursor?: string;
  status?: PaymentStatus;
  currency?: Currency;
  q?: string;
  limit?: number;
};

export interface UpdateStatusPayload {
  status: PaymentStatus;
  reason?: string;
}
