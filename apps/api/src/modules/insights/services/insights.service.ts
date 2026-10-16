import type {
  ActivityBucketView,
  CodeCountView,
  Currency,
  InsightsRange,
  InsightsView,
  PaymentFailureCode,
} from '@payment-sim/shared';
import { INSIGHT_WINDOWS, PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { PaymentEventRepository } from '../../payments/repository/payment-event.repository';
import type { PaymentRepository } from '../../payments/repository/payment.repository';
import { percentile } from '../../payments/repository/payment.repository';

export interface InsightsServiceDeps {
  payments: PaymentRepository;
  events: PaymentEventRepository;
  clock?: () => Date;
}

const RATE_WINDOW_MS = 5 * 60_000;

type Outcome = 'succeeded' | 'failed' | 'cancelled' | 'refunded';
const OUTCOME_BY_STATUS: Partial<Record<PaymentStatus, Outcome>> = {
  [PaymentStatus.SUCCEEDED]: 'succeeded',
  [PaymentStatus.FAILED]: 'failed',
  [PaymentStatus.CANCELLED]: 'cancelled',
  [PaymentStatus.REFUNDED]: 'refunded',
};

function countBy<T>(items: T[], key: (item: T) => PaymentFailureCode | undefined) {
  const counts = new Map<PaymentFailureCode, number>();
  for (const item of items) {
    const code = key(item);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts]
    .map(([code, count]): CodeCountView => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * Analytics over a window ending now. Activity is counted from the audit log (when each
 * thing happened), outcomes and latency from the payments settled in the window. Everything
 * is computed from the store on request: at a JSON file's scale that is a few milliseconds;
 * at real scale these would be rollups maintained as events are written.
 */
export class InsightsService {
  private readonly clock: () => Date;

  constructor(private readonly deps: InsightsServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async insights(range: InsightsRange): Promise<InsightsView> {
    const { rangeMs, bucketMs } = INSIGHT_WINDOWS[range];
    const now = this.clock().getTime();
    // Whole buckets, the last one containing now, so bars never shift mid-bucket.
    const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
    const start = end - rangeMs;

    const [events, payments] = await Promise.all([
      this.deps.events.listBetween(new Date(start), new Date(end)),
      this.deps.payments.all(),
    ]);

    const buckets: ActivityBucketView[] = Array.from(
      { length: Math.round(rangeMs / bucketMs) },
      (_, i) => ({
        start: new Date(start + i * bucketMs).toISOString(),
        created: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        refunded: 0,
        retries: 0,
      }),
    );
    const totals = {
      created: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      refunded: 0,
      retries: 0,
    };
    let recentCreated = 0;
    const retryCodes: Array<PaymentFailureCode | undefined> = [];

    for (const event of events) {
      const at = event.createdAt.getTime();
      const bucket = buckets[Math.floor((at - start) / bucketMs)];
      if (!bucket) continue;
      let field: keyof typeof totals | undefined;
      if (event.type === PaymentEventType.CREATED) {
        field = 'created';
        if (at > now - RATE_WINDOW_MS) recentCreated++;
      } else if (event.type === PaymentEventType.ATTEMPT_FAILED) {
        field = 'retries';
        retryCodes.push(event.metadata.code as PaymentFailureCode | undefined);
      } else if (event.toStatus) {
        field = OUTCOME_BY_STATUS[event.toStatus];
      }
      if (field) {
        bucket[field]++;
        totals[field]++;
      }
    }

    const settled = payments.filter((p) => {
      const at = p.processedAt?.getTime();
      return at !== undefined && at >= start && at < end;
    });
    // A refunded payment was approved first; it counts as an approval.
    const approved = settled.filter((p) => p.status !== PaymentStatus.FAILED);
    const failed = settled.filter((p) => p.status === PaymentStatus.FAILED);

    const volume: Partial<Record<Currency, number>> = {};
    for (const p of approved) volume[p.currency] = (volume[p.currency] ?? 0) + p.amount;

    const durations = settled
      .map((p) => (p.processedAt as Date).getTime() - p.createdAt.getTime())
      .sort((a, b) => a - b);
    const round = (v: number | null) => (v === null ? null : Math.round(v));

    const byAttempts = new Map<number, { succeeded: number; failed: number }>();
    for (const p of settled) {
      const row = byAttempts.get(p.attempts) ?? { succeeded: 0, failed: 0 };
      if (p.status === PaymentStatus.FAILED) row.failed++;
      else row.succeeded++;
      byAttempts.set(p.attempts, row);
    }

    return {
      range,
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      bucketMs,
      buckets,
      totals: {
        ...totals,
        approvalRate:
          settled.length === 0
            ? null
            : approved.length / (approved.length + failed.length),
        approvedVolumeByCurrency: volume,
        ratePerMinute: Math.round((recentCreated / (RATE_WINDOW_MS / 60_000)) * 10) / 10,
        inFlight: payments.filter(
          (p) =>
            p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
        ).length,
      },
      latencyMs: {
        p50: round(percentile(durations, 0.5)),
        p95: round(percentile(durations, 0.95)),
      },
      failures: {
        byCode: countBy(failed, (p) => p.failureCode ?? undefined),
        retriesByCode: countBy(retryCodes, (code) => code),
        attempts: [...byAttempts]
          .sort(([a], [b]) => a - b)
          .map(([attempts, row]) => ({ attempts, ...row })),
        firstAttemptSuccess: approved.filter((p) => p.attempts <= 1).length,
        recoveredByRetry: approved.filter((p) => p.attempts > 1).length,
        failedAfterRetries: failed.filter((p) => p.attempts > 1).length,
      },
    };
  }
}
