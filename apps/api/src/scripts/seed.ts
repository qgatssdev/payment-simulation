/**
 * Fill a data file with several days of SYNTHETIC payment activity for demos and screenshots.
 *
 *   pnpm --filter @payment-sim/api seed                 # 5 days into ./data/payments.json
 *   pnpm --filter @payment-sim/api seed -- --days 7 --reset --file /tmp/demo.json
 *
 * Everything it writes is marked as synthetic: every audit event carries `synthetic: true`,
 * customers use the reserved example.com domain, and cards are the simulator's test cards
 * (only brand and last four digits are ever stored). The histories mirror what the real
 * worker records (pickup, gateway latency, retries with exponential backoff and full jitter,
 * timeouts, refunds, cancellations) so every screen has something truthful to show.
 *
 * It opens the store the way the API does, taking the data file's lock, so it refuses to run
 * while an API is using the same file. Deterministic: the same --seed gives the same data.
 */
import { randomUUID } from 'node:crypto';
import type { Currency } from '@payment-sim/shared';
import {
  CardBrand,
  PaymentEventType,
  PaymentFailureCode,
  PaymentStatus,
} from '@payment-sim/shared';
import { STORE_FORMAT, openPaymentStore } from '../infra/store/payment-store';
import type { StoreTx } from '../infra/store/payment-store';
import { createLogger } from '../libs/core/logger/logger';
import type { IdempotencyKey } from '../modules/payments/entity/idempotency-key.entity';
import type { PaymentEvent } from '../modules/payments/entity/payment-event.entity';
import type { PaymentData } from '../modules/payments/entity/payment.entity';
import { toPaymentView } from '../modules/payments/mappers/payment.mapper';
import { Payment } from '../modules/payments/entity/payment.entity';
import type { Job } from '../modules/processing/entity/job.entity';
import { JobStatus, JobType } from '../modules/processing/entity/job.entity';

// ---------------------------------------------------------------------------------------------
// Options

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const DAYS = Number(option('days', '5'));
const FILE = option('file', process.env.DATA_FILE || './data/payments.json');
const RESET = process.argv.includes('--reset');
const SEED = Number(option('seed', '20261016'));

// Mirrors the API's defaults, so seeded histories look like real ones.
const GATEWAY = { minLatencyMs: 300, maxLatencyMs: 2_500, timeoutMs: 3_000 };
const BACKOFF = { baseDelayMs: 1_000, maxDelayMs: 30_000 };
const MAX_ATTEMPTS = 4;
const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

// ---------------------------------------------------------------------------------------------
// Deterministic randomness

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const between = (min: number, max: number) => min + random() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;
function weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [item, w] of items) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return items[items.length - 1]![0];
}
/** Log-normal-ish amount around a typical value, rounded to a believable price. */
function price(typical: number, step: number): number {
  const factor = Math.exp((random() + random() + random() - 1.5) * 1.1);
  return Math.max(step, Math.round((typical * factor) / step) * step);
}
const hex = (bytes: number) =>
  Array.from({ length: bytes }, () => int(0, 255).toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------------------------------------
// Who pays whom

interface Merchant {
  name: string;
  currency: Currency;
  /** Typical basket in minor units, and the rounding step prices use. */
  typical: number;
  step: number;
  weight: number;
  items: string[];
  /** Hours from UTC of the merchant's customers, for the daily rhythm. */
  utcOffset: number;
}

const MERCHANTS: Merchant[] = [
  {
    name: 'Kòkó Coffee Lekki',
    currency: 'NGN',
    typical: 650_000,
    step: 5_000,
    weight: 9,
    items: ['Iced latte ×2', 'Flat white & croissant', 'Beans 250 g', 'Breakfast set'],
    utcOffset: 1,
  },
  {
    name: 'Mama Put Kitchen',
    currency: 'NGN',
    typical: 1_200_000,
    step: 10_000,
    weight: 10,
    items: ['Jollof & chicken', 'Ofada rice special', 'Family pack', 'Pepper soup ×3'],
    utcOffset: 1,
  },
  {
    name: 'Ìrìn Rides',
    currency: 'NGN',
    typical: 450_000,
    step: 1_000,
    weight: 12,
    items: [
      'Trip Yaba → VI',
      'Trip Ikeja → Lekki',
      'Airport drop-off',
      'Trip Surulere → Ikoyi',
    ],
    utcOffset: 1,
  },
  {
    name: 'Ankara & Co.',
    currency: 'NGN',
    typical: 3_500_000,
    step: 50_000,
    weight: 5,
    items: ['Wax print, 6 yards', 'Agbada set', 'Tailoring deposit', 'Headwrap bundle'],
    utcOffset: 1,
  },
  {
    name: 'Ọjà Fresh',
    currency: 'NGN',
    typical: 2_400_000,
    step: 10_000,
    weight: 7,
    items: ['Weekly groceries', 'Produce box', 'Pantry restock'],
    utcOffset: 1,
  },
  {
    name: 'Brixton Bike Works',
    currency: 'GBP',
    typical: 6_500,
    step: 50,
    weight: 4,
    items: ['Service, standard', 'Tubes & tyres', 'Brake bleed', 'Helmet'],
    utcOffset: 0,
  },
  {
    name: 'Halden Books',
    currency: 'GBP',
    typical: 2_400,
    step: 1,
    weight: 5,
    items: ['2 paperbacks', 'Gift card', 'Signed edition', 'Order online'],
    utcOffset: 0,
  },
  {
    name: 'Northwind Studio',
    currency: 'GBP',
    typical: 18_000,
    step: 500,
    weight: 2,
    items: ['Logo package', 'Photography session', 'Retainer, October'],
    utcOffset: 0,
  },
  {
    name: 'Café Lisboa',
    currency: 'EUR',
    typical: 1_850,
    step: 5,
    weight: 5,
    items: ['Pastéis ×6', 'Lunch for two', 'Coffee subscription'],
    utcOffset: 1,
  },
  {
    name: 'Fjord Outdoor',
    currency: 'EUR',
    typical: 12_900,
    step: 100,
    weight: 3,
    items: ['Rain shell', 'Trail shoes', 'Tent, 2 person', 'Base layer set'],
    utcOffset: 2,
  },
  {
    name: 'Pixelforge Cloud',
    currency: 'USD',
    typical: 4_900,
    step: 100,
    weight: 5,
    items: ['Pro plan, monthly', 'Extra seats ×3', 'Usage top-up', 'Team plan, annual'],
    utcOffset: -5,
  },
  {
    name: 'Harbor Supply',
    currency: 'USD',
    typical: 8_600,
    step: 1,
    weight: 3,
    items: ['Wholesale order', 'Restock invoice', 'Sample kit'],
    utcOffset: -5,
  },
];

const FIRST = [
  'Adaeze',
  'Tobi',
  'Chinedu',
  'Amara',
  'Ifeoma',
  'Kunle',
  'Zainab',
  'Femi',
  'Ngozi',
  'Seun',
  'Halima',
  'Emeka',
  'Olivia',
  'Harry',
  'Priya',
  'Tom',
  'Grace',
  'Liam',
  'Sofia',
  'Mateo',
  'Inês',
  'Lars',
  'Maya',
  'Daniel',
];
const LAST = [
  'Okafor',
  'Adeyemi',
  'Bello',
  'Eze',
  'Balogun',
  'Nwosu',
  'Mohammed',
  'Okonkwo',
  'Smith',
  'Patel',
  'Clarke',
  'Evans',
  'Silva',
  'Costa',
  'Berg',
  'Nakamura',
  'Johnson',
  'Mensah',
];

/** The simulator's test cards: the scenario is part of the token, exactly as tokenize() does. */
const SCENARIOS = [
  { scenario: 'succeed', brand: CardBrand.VISA, last4: '4242', weight: 54 },
  { scenario: 'succeed', brand: CardBrand.MASTERCARD, last4: '4444', weight: 22 },
  { scenario: 'decline.card_declined', brand: CardBrand.VISA, last4: '0002', weight: 6 },
  {
    scenario: 'decline.insufficient_funds',
    brand: CardBrand.VISA,
    last4: '9995',
    weight: 6,
  },
  { scenario: 'transient.2', brand: CardBrand.VISA, last4: '0119', weight: 9 },
  { scenario: 'timeout', brand: CardBrand.VISA, last4: '0077', weight: 3 },
] as const;

const DECLINE_MESSAGES: Record<string, string> = {
  card_declined: 'The card was declined by the issuer',
  insufficient_funds: 'The card has insufficient funds',
};
const REFUND_REASONS = [
  'Item returned',
  'Duplicate order',
  'Customer request',
  'Damaged on arrival',
  'Service not delivered',
];
const CANCEL_REASONS = [
  'Customer changed their mind',
  'Wrong amount entered',
  'Duplicate checkout',
];

// ---------------------------------------------------------------------------------------------
// Traffic shape

/** Relative traffic by local hour: quiet nights, a lunch peak and an evening peak. */
const HOURLY = [
  0.15, 0.08, 0.05, 0.05, 0.08, 0.2, 0.45, 0.8, 1.0, 1.1, 1.25, 1.4, 1.55, 1.45, 1.2, 1.1,
  1.15, 1.3, 1.6, 1.75, 1.5, 1.1, 0.7, 0.35,
];
const PER_HOUR_AT_PEAK = 14;

// ---------------------------------------------------------------------------------------------
// Building one payment's history

interface Draft {
  payment: PaymentData;
  events: Array<Omit<PaymentEvent, 'sequence'>>;
  job: Job;
  key: IdempotencyKey | null;
}

function backoff(attempt: number): number {
  const ceiling = Math.min(BACKOFF.maxDelayMs, BACKOFF.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

function draftPayment(createdAt: Date, now: Date, spike: boolean): Draft {
  const merchant = weighted(
    MERCHANTS.map(
      (m) => [m, m.weight * (spike && m.currency === 'NGN' ? 3 : 1)] as const,
    ),
  );
  const card = weighted(SCENARIOS.map((s) => [s, s.weight] as const));
  const first = pick(FIRST);
  const last = pick(LAST);
  const id = randomUUID();
  const jobId = randomUUID();
  const requestId = randomUUID();
  const t0 = createdAt.getTime();

  const payment: PaymentData = {
    id,
    amount: price(merchant.typical, merchant.step),
    currency: merchant.currency,
    status: PaymentStatus.PENDING,
    paymentMethod: {
      token: `tok_sim_${card.scenario}_${hex(8)}`,
      brand: card.brand,
      last4: card.last4,
      expMonth: int(1, 12),
      expYear: now.getUTCFullYear() + int(1, 4),
    },
    customerEmail: `${first}.${last}${int(1, 99)}@example.com`.toLowerCase(),
    description: `${pick(merchant.items)} · ${merchant.name}${spike ? ' · Flash sale' : ''}`,
    failureCode: null,
    failureMessage: null,
    attempts: 0,
    processedAt: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };

  const events: Draft['events'] = [];
  const event = (at: number, e: Partial<PaymentEvent> & Pick<PaymentEvent, 'type'>) =>
    events.push({
      id: randomUUID(),
      paymentId: id,
      fromStatus: null,
      toStatus: null,
      reason: null,
      ...e,
      metadata: { synthetic: true, ...e.metadata },
      createdAt: new Date(at),
    });
  const move = (at: number, to: PaymentStatus, e: Partial<PaymentEvent> = {}) => {
    event(at, {
      type: PaymentEventType.STATUS_CHANGED,
      fromStatus: payment.status,
      toStatus: to,
      ...e,
    });
    payment.status = to;
    payment.version++;
    payment.updatedAt = new Date(at);
  };

  event(t0, {
    type: PaymentEventType.CREATED,
    toStatus: PaymentStatus.PENDING,
    metadata: { amount: payment.amount, currency: payment.currency, requestId },
  });

  let t = t0 + int(15, 90);
  const cancelled = random() < 0.02;
  if (cancelled) {
    move(t0 + int(40, 400), PaymentStatus.CANCELLED, {
      reason: pick(CANCEL_REASONS),
      metadata: { actor: 'client', requestId: randomUUID() },
    });
  } else {
    move(t, PaymentStatus.PROCESSING, {
      metadata: { actor: 'system', attempt: 1, jobId },
    });
    const scenario: string = card.scenario;
    for (let attempt = 1; ; attempt++) {
      const startedAt = t;
      const latency = int(GATEWAY.minLatencyMs, GATEWAY.maxLatencyMs);
      const timing = (ms: number) => ({
        startedAt: new Date(startedAt).toISOString(),
        durationMs: ms,
      });
      payment.attempts = attempt;

      const transient =
        scenario.startsWith('transient.') && attempt <= Number(scenario.split('.')[1]);
      const timesOut = scenario === 'timeout';
      if (transient || timesOut) {
        const duration = timesOut ? GATEWAY.timeoutMs + int(1, 6) : latency;
        const code = timesOut
          ? PaymentFailureCode.GATEWAY_TIMEOUT
          : PaymentFailureCode.PROCESSING_ERROR;
        const message = timesOut
          ? `Gateway did not respond within ${GATEWAY.timeoutMs}ms`
          : `Gateway processing error on attempt ${attempt}`;
        t = startedAt + duration;
        if (attempt >= MAX_ATTEMPTS) {
          payment.failureCode = code;
          payment.failureMessage = `${message}; gave up after ${attempt} attempts`;
          payment.processedAt = new Date(t);
          move(t, PaymentStatus.FAILED, {
            reason: payment.failureMessage,
            metadata: { actor: 'system', attempt, code, jobId, ...timing(duration) },
          });
          break;
        }
        const delay = backoff(attempt);
        event(t, {
          type: PaymentEventType.ATTEMPT_FAILED,
          reason: message,
          metadata: {
            attempt,
            code,
            retryAt: new Date(t + delay).toISOString(),
            jobId,
            ...timing(duration),
          },
        });
        payment.version++;
        payment.updatedAt = new Date(t);
        t += delay + int(5, 60); // the worker picks the job up shortly after it is due
        continue;
      }

      t = startedAt + latency;
      payment.processedAt = new Date(t);
      if (scenario.startsWith('decline.')) {
        const code = scenario.slice('decline.'.length) as PaymentFailureCode;
        payment.failureCode = code;
        payment.failureMessage = DECLINE_MESSAGES[code] ?? 'The payment was declined';
        move(t, PaymentStatus.FAILED, {
          reason: payment.failureMessage,
          metadata: {
            actor: 'system',
            attempt,
            code,
            latencyMs: latency,
            jobId,
            ...timing(latency),
          },
        });
      } else {
        move(t, PaymentStatus.SUCCEEDED, {
          reason: 'Approved by the gateway',
          metadata: {
            actor: 'system',
            attempt,
            authorizationCode: `AUTH${hex(3).toUpperCase()}`,
            latencyMs: latency,
            jobId,
            ...timing(latency),
          },
        });
        // Some approvals are refunded later, minutes to a day afterwards, but not in the future.
        const refundAt = t + int(5 * 60_000, 26 * 3_600_000);
        if (random() < 0.05 && refundAt < now.getTime()) {
          move(refundAt, PaymentStatus.REFUNDED, {
            reason: pick(REFUND_REASONS),
            metadata: { actor: 'client', requestId: randomUUID() },
          });
        }
      }
      break;
    }
  }

  const job: Job = {
    id: jobId,
    type: JobType.PROCESS_PAYMENT,
    paymentId: id,
    status: JobStatus.COMPLETED,
    attempts: Math.max(1, payment.attempts),
    maxAttempts: MAX_ATTEMPTS,
    runAt: createdAt,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    completedAt: new Date(t),
    createdAt,
    updatedAt: new Date(t),
  };

  // Keys live 24 hours; only recent payments still have one. A few were retried by clients.
  let key: IdempotencyKey | null = null;
  if (now.getTime() - t0 < IDEMPOTENCY_TTL_MS) {
    const created = Payment.from({
      ...payment,
      status: PaymentStatus.PENDING,
      version: 1,
      attempts: 0,
      failureCode: null,
      failureMessage: null,
      processedAt: null,
      updatedAt: createdAt,
    });
    const replays = random() < 0.04 ? int(1, 2) : 0;
    key = {
      key: random() < 0.5 ? `order-${hex(4)}` : randomUUID(),
      requestHash: hex(32),
      responseStatus: 202,
      responseBody: {
        success: true,
        message: 'Payment accepted for processing',
        data: toPaymentView(created),
      },
      paymentId: id,
      createdAt,
      expiresAt: new Date(t0 + IDEMPOTENCY_TTL_MS),
      replayCount: replays,
      lastReplayedAt: replays ? new Date(t0 + int(800, 6_000)) : null,
    };
  }
  return { payment, events, job, key };
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const logger = createLogger({ level: 'warn', pretty: false });
  const store = await openPaymentStore({ file: FILE, logger }).catch((err: unknown) => {
    throw new Error(
      `Could not open ${FILE} (${err instanceof Error ? err.message : String(err)}). Stop any API using this file first.`,
    );
  });

  try {
    const existing = store.count('payments');
    if (existing > 0 && !RESET) {
      throw new Error(
        `${FILE} already holds ${existing} payments. Re-run with --reset to replace them.`,
      );
    }

    const now = new Date();
    const start = now.getTime() - DAYS * 86_400_000;
    // The traffic spike: a flash sale on the evening before last (Lagos time).
    const spikeDay = new Date(now.getTime() - 2 * 86_400_000);
    spikeDay.setUTCHours(18, 0, 0, 0);
    const spikeFrom = spikeDay.getTime();
    const spikeTo = spikeFrom + 75 * 60_000;

    const drafts: Draft[] = [];
    for (let hour = start; hour < now.getTime(); hour += 3_600_000) {
      const local = new Date(hour + 3_600_000); // most customers are in Lagos (UTC+1)
      const weekend = local.getUTCDay() === 0 || local.getUTCDay() === 6;
      const rate = PER_HOUR_AT_PEAK * HOURLY[local.getUTCHours()]! * (weekend ? 0.7 : 1);
      const count = Math.round(rate * between(0.75, 1.25));
      for (let i = 0; i < count; i++) {
        const at = new Date(hour + random() * 3_600_000);
        if (at.getTime() < now.getTime() - 5_000)
          drafts.push(draftPayment(at, now, false));
      }
    }
    for (let at = spikeFrom; at < spikeTo; at += int(8_000, 30_000)) {
      drafts.push(draftPayment(new Date(at), now, true));
    }

    await store.transaction((tx: StoreTx) => {
      if (RESET) {
        for (const name of [
          'payments',
          'paymentEvents',
          'idempotencyKeys',
          'jobs',
        ] as const) {
          for (const record of tx.find(name)) {
            tx.delete(
              name,
              (record as { id?: string; key?: string }).id ??
                (record as { key: string }).key,
            );
          }
        }
      }
      for (const d of drafts) {
        tx.put('payments', d.payment);
        tx.put('jobs', d.job);
        if (d.key) tx.put('idempotencyKeys', d.key);
      }
      // One global, gap-free sequence in time order, as if the events had happened live.
      const events = drafts
        .flatMap((d) => d.events)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const e of events) {
        tx.put('paymentEvents', { ...e, sequence: tx.nextSequence('paymentEvents') });
      }
    });
    await store.flush();

    const by = (s: PaymentStatus) => drafts.filter((d) => d.payment.status === s).length;
    console.log(
      `Seeded ${drafts.length} synthetic payments over ${DAYS} days into ${FILE} (${STORE_FORMAT}): ` +
        `${by(PaymentStatus.SUCCEEDED)} succeeded, ${by(PaymentStatus.REFUNDED)} refunded, ` +
        `${by(PaymentStatus.FAILED)} failed, ${by(PaymentStatus.CANCELLED)} cancelled; ` +
        `flash-sale spike at ${new Date(spikeFrom).toISOString()}.`,
    );
  } finally {
    await store.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
