import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SimulatedOutcome } from '@payment-sim/shared';
import { PaymentFailureCode, detectCardBrand, findTestCard } from '@payment-sim/shared';
import type {
  CardDetails,
  CardToken,
  ChargeRequest,
  ChargeResult,
  PaymentGateway,
} from './payment-gateway';
import { GatewayError } from './payment-gateway';

export interface MockGatewayOptions {
  minLatencyMs: number;
  maxLatencyMs: number;
  /** Applied to cards that are not test cards. */
  declineRate: number;
  transientErrorRate: number;
  random?: () => number;
}

/**
 * Scenario names are embedded in tokens so a payment's simulated behaviour is decided once, at
 * tokenization, and survives restarts and moves between instances. A real PSP token is opaque;
 * this one is readable only because the "vault" is a naming convention.
 */
type Scenario =
  | 'succeed'
  | `decline.${PaymentFailureCode}`
  | `transient.${number}`
  | 'timeout'
  | 'random';

const TOKEN = /^tok_sim_([a-z_.0-9]+)_[0-9a-f]{16}$/;

function scenarioFor(outcome: SimulatedOutcome | undefined): Scenario {
  switch (outcome?.kind) {
    case 'succeed':
      return 'succeed';
    case 'decline':
      return `decline.${outcome.code}`;
    case 'transient':
      return `transient.${outcome.failures}`;
    case 'timeout':
      return 'timeout';
    default:
      return 'random';
  }
}

export class MockPaymentGateway implements PaymentGateway {
  private readonly random: () => number;
  /** Final results by idempotency key: what a real PSP's dedup store would hold. */
  private readonly settled = new Map<string, ChargeResult>();
  private approvals = 0;

  constructor(private readonly options: MockGatewayOptions) {
    this.random = options.random ?? Math.random;
  }

  /** Number of distinct charges approved, i.e. money actually taken. */
  get approvedCharges(): number {
    return this.approvals;
  }

  tokenize(card: CardDetails): CardToken {
    const scenario = scenarioFor(findTestCard(card.number)?.outcome);
    return {
      token: `tok_sim_${scenario}_${randomBytes(8).toString('hex')}`,
      brand: detectCardBrand(card.number),
      last4: card.number.slice(-4),
    };
  }

  async charge(request: ChargeRequest, signal: AbortSignal): Promise<ChargeResult> {
    const previous = this.settled.get(request.idempotencyKey);
    if (previous) return previous;

    const scenario = this.parseScenario(request.token);
    const startedAt = performance.now();

    // A gateway that never answers: only the caller's deadline ends the wait.
    if (scenario === 'timeout') {
      await sleep(2 ** 31 - 1, undefined, { signal, ref: false });
    }
    await sleep(this.latency(), undefined, { signal });
    const latencyMs = Math.round(performance.now() - startedAt);

    const result = this.decide(scenario, request, latencyMs);
    this.settled.set(request.idempotencyKey, result);
    if (result.status === 'approved') this.approvals++;
    return result;
  }

  private decide(
    scenario: Scenario,
    request: ChargeRequest,
    latencyMs: number,
  ): ChargeResult {
    if (scenario.startsWith('decline.')) {
      return this.declined(
        scenario.slice('decline.'.length) as PaymentFailureCode,
        latencyMs,
      );
    }
    if (scenario.startsWith('transient.')) {
      const failures = Number(scenario.slice('transient.'.length));
      if (request.attempt <= failures) throw this.transientError(request.attempt);
      return this.approved(latencyMs);
    }
    if (scenario === 'random') {
      const roll = this.random();
      if (roll < this.options.declineRate) {
        return this.declined(PaymentFailureCode.CARD_DECLINED, latencyMs);
      }
      if (roll < this.options.declineRate + this.options.transientErrorRate) {
        throw this.transientError(request.attempt);
      }
    }
    return this.approved(latencyMs);
  }

  private parseScenario(token: string): Scenario {
    const match = TOKEN.exec(token);
    if (!match?.[1]) {
      throw new GatewayError(
        PaymentFailureCode.PROCESSING_ERROR,
        'Unknown card token',
        false,
      );
    }
    return match[1] as Scenario;
  }

  private latency(): number {
    const { minLatencyMs, maxLatencyMs } = this.options;
    const span = Math.max(0, maxLatencyMs - minLatencyMs);
    return Math.round(minLatencyMs + this.random() * span);
  }

  private approved(latencyMs: number): ChargeResult {
    return {
      status: 'approved',
      authorizationCode: `AUTH${randomBytes(3).toString('hex').toUpperCase()}`,
      latencyMs,
    };
  }

  private declined(code: PaymentFailureCode, latencyMs: number): ChargeResult {
    const messages: Partial<Record<PaymentFailureCode, string>> = {
      [PaymentFailureCode.CARD_DECLINED]: 'The card was declined by the issuer',
      [PaymentFailureCode.INSUFFICIENT_FUNDS]: 'The card has insufficient funds',
      [PaymentFailureCode.EXPIRED_CARD]: 'The card has expired',
    };
    return {
      status: 'declined',
      code,
      message: messages[code] ?? 'The payment was declined',
      latencyMs,
    };
  }

  private transientError(attempt: number): GatewayError {
    return new GatewayError(
      PaymentFailureCode.PROCESSING_ERROR,
      `Gateway processing error on attempt ${attempt}`,
      true,
    );
  }
}
