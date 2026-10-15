import type { CardBrand, Currency, PaymentFailureCode } from '@payment-sim/shared';

export interface CardDetails {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}

export interface CardToken {
  /** Opaque reference to the card held by the gateway; the only thing we store. */
  token: string;
  brand: CardBrand;
  last4: string;
}

export interface ChargeRequest {
  token: string;
  amount: number;
  currency: Currency;
  /**
   * The gateway deduplicates on this. Retrying a charge with the same key (after a timeout,
   * or after a worker crash between "approved" and recording it) returns the original result
   * instead of charging the card twice.
   */
  idempotencyKey: string;
  /** 1-based attempt number, for logging and for the simulated flaky scenario. */
  attempt: number;
}

/**
 * Business outcomes are results; transport/availability problems are thrown as GatewayError.
 * A decline is a final answer about this payment. A timeout says nothing about it.
 */
export type ChargeResult =
  | { status: 'approved'; authorizationCode: string; latencyMs: number }
  | {
      status: 'declined';
      code: PaymentFailureCode;
      message: string;
      latencyMs: number;
    };

export class GatewayError extends Error {
  constructor(
    readonly code: PaymentFailureCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GatewayError';
  }
}

export interface PaymentGateway {
  /** Synchronous and local: in production the client would tokenize directly with the PSP. */
  tokenize(card: CardDetails): CardToken;
  /** Must honour `signal`: abort means the caller has stopped waiting. */
  charge(request: ChargeRequest, signal: AbortSignal): Promise<ChargeResult>;
}
