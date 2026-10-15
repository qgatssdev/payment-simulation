import { randomUUID } from 'node:crypto';
import type { Currency } from '@payment-sim/shared';
import { PaymentStatus } from '@payment-sim/shared';
import type { PaymentStore, StoreTx } from '../../../infra/store/payment-store';
import type { KeysetCursor } from '../../../libs/common/http/cursor';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import type { PaymentData, PaymentMethod } from '../entity/payment.entity';
import { Payment } from '../entity/payment.entity';

export interface NewPayment {
  amount: number;
  currency: Currency;
  customerEmail: string;
  description: string | null;
  paymentMethod: PaymentMethod;
}

export interface PageQuery {
  limit: number;
  after?: KeysetCursor;
  status?: PaymentStatus;
  currency?: Currency;
  from?: string;
  to?: string;
}

export interface PaymentPage {
  items: Payment[];
  /** Cursor after the last item, when more rows follow. */
  next: KeysetCursor | null;
}

export interface PaymentAggregates {
  countsByStatus: Array<{ status: PaymentStatus; count: number }>;
  succeededVolume: Array<{ currency: Currency; total: number }>;
  processingTimeMs: { p50: number | null; p95: number | null };
}

/** Newest first; id breaks ties between payments created in the same millisecond. */
function newestFirst(a: PaymentData, b: PaymentData): number {
  return (
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** Linear interpolation between closest ranks: the same definition as SQL's percentile_cont. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

export class PaymentRepository extends BaseRepository<'payments'> {
  constructor(store: PaymentStore, tx?: StoreTx) {
    super(store, 'payments', tx);
  }

  async insert(data: NewPayment): Promise<Payment> {
    const now = this.now();
    const payment = Payment.from({
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: PaymentStatus.PENDING,
      failureCode: null,
      failureMessage: null,
      attempts: 0,
      processedAt: null,
    });
    await this.write((tx) => tx.put('payments', payment));
    return payment;
  }

  findById(id: string): Promise<Payment | null> {
    const data = this.reader.get('payments', id);
    return Promise.resolve(data ? Payment.from(data) : null);
  }

  findByIds(ids: string[]): Promise<Payment[]> {
    const wanted = new Set(ids);
    return Promise.resolve(
      this.reader.find('payments', (p) => wanted.has(p.id)).map((p) => Payment.from(p)),
    );
  }

  /**
   * Optimistic write: persist the payment's mutable fields only if it is still at the version
   * the caller read. Returns the fresh payment, or null when another writer got there first.
   */
  updateIfVersion(payment: Payment, expectedVersion: number): Promise<Payment | null> {
    return this.write((tx) => {
      const current = tx.get('payments', payment.id);
      if (!current || current.version !== expectedVersion) return null;
      const updated: PaymentData = {
        ...current,
        status: payment.status,
        processedAt: payment.processedAt,
        failureCode: payment.failureCode,
        failureMessage: payment.failureMessage,
        attempts: payment.attempts,
        version: current.version + 1,
        updatedAt: this.now(),
      };
      tx.put('payments', updated);
      return Payment.from(updated);
    });
  }

  /**
   * Keyset pagination: everything strictly after the cursor's (createdAt, id) in newest-first
   * order. Rows inserted meanwhile never shift what the reader sees. This scans and sorts in
   * memory, which is fine at a JSON file's scale; see the README for what would change.
   */
  listPage({
    limit,
    after,
    status,
    currency,
    from,
    to,
  }: PageQuery): Promise<PaymentPage> {
    const fromTime = from ? new Date(from).getTime() : undefined;
    const toTime = to ? new Date(to).getTime() : undefined;
    const afterTime = after ? new Date(after.createdAt).getTime() : undefined;

    const matches = this.reader
      .find('payments', (p) => {
        const created = p.createdAt.getTime();
        return (
          (!status || p.status === status) &&
          (!currency || p.currency === currency) &&
          (fromTime === undefined || created >= fromTime) &&
          (toTime === undefined || created < toTime) &&
          (afterTime === undefined ||
            created < afterTime ||
            (created === afterTime && p.id < (after as KeysetCursor).id))
        );
      })
      .sort(newestFirst);

    const items = matches.slice(0, limit).map((p) => Payment.from(p));
    const last = items.at(-1);
    return Promise.resolve({
      items,
      next:
        matches.length > limit && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null,
    });
  }

  aggregates(): Promise<PaymentAggregates> {
    const counts = new Map<PaymentStatus, number>();
    const volume = new Map<Currency, number>();
    const durations: number[] = [];

    for (const p of this.reader.find('payments')) {
      counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
      if (p.status === PaymentStatus.SUCCEEDED) {
        volume.set(p.currency, (volume.get(p.currency) ?? 0) + p.amount);
      }
      if (p.processedAt) durations.push(p.processedAt.getTime() - p.createdAt.getTime());
    }
    durations.sort((a, b) => a - b);

    const round = (v: number | null) => (v === null ? null : Math.round(v));
    return Promise.resolve({
      countsByStatus: [...counts].map(([status, count]) => ({ status, count })),
      succeededVolume: [...volume].map(([currency, total]) => ({ currency, total })),
      processingTimeMs: {
        p50: round(percentile(durations, 0.5)),
        p95: round(percentile(durations, 0.95)),
      },
    });
  }
}
