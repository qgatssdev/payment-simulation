import { CardBrand } from './card';
import { PaymentFailureCode } from './error-codes';

/**
 * What the simulated gateway does with a card. Any card not listed here gets the gateway's
 * configurable random behaviour.
 */
export type SimulatedOutcome =
  | { kind: 'succeed' }
  | { kind: 'decline'; code: PaymentFailureCode }
  /** Fails with a retryable error `failures` times, then succeeds. */
  | { kind: 'transient'; failures: number; code: PaymentFailureCode }
  /** Never answers in time; every attempt times out until retries are exhausted. */
  | { kind: 'timeout' };

export interface TestCard {
  readonly number: string;
  readonly brand: CardBrand;
  readonly label: string;
  readonly description: string;
  readonly outcome: SimulatedOutcome;
}

export const TEST_CARDS: readonly TestCard[] = [
  {
    number: '4242424242424242',
    brand: CardBrand.VISA,
    label: 'Success',
    description: 'Approved on the first attempt.',
    outcome: { kind: 'succeed' },
  },
  {
    number: '5555555555554444',
    brand: CardBrand.MASTERCARD,
    label: 'Success (Mastercard)',
    description: 'Approved on the first attempt.',
    outcome: { kind: 'succeed' },
  },
  {
    number: '4000000000000002',
    brand: CardBrand.VISA,
    label: 'Declined',
    description: 'Permanently declined by the issuer. Not retried.',
    outcome: { kind: 'decline', code: PaymentFailureCode.CARD_DECLINED },
  },
  {
    number: '4000000000009995',
    brand: CardBrand.VISA,
    label: 'Insufficient funds',
    description: 'Permanently declined for insufficient funds. Not retried.',
    outcome: { kind: 'decline', code: PaymentFailureCode.INSUFFICIENT_FUNDS },
  },
  {
    number: '4000000000000119',
    brand: CardBrand.VISA,
    label: 'Flaky gateway',
    description: 'Fails twice with a retryable processing error, then succeeds.',
    outcome: {
      kind: 'transient',
      failures: 2,
      code: PaymentFailureCode.PROCESSING_ERROR,
    },
  },
  {
    number: '4000000000000077',
    brand: CardBrand.VISA,
    label: 'Gateway timeout',
    description: 'Every attempt times out; fails once retries are exhausted.',
    outcome: { kind: 'timeout' },
  },
];

export function findTestCard(cardNumber: string): TestCard | undefined {
  return TEST_CARDS.find((card) => card.number === cardNumber);
}
