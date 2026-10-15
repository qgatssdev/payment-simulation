import type { Currency } from '@payment-sim/shared';
import { PaymentStatus } from '@payment-sim/shared';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type { KeysetCursor } from '../../../libs/common/http/cursor';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { Payment } from '../entity/payment.entity';

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

export class PaymentRepository extends BaseRepository<Payment> {
  constructor(manager: EntityManager) {
    super(manager.getRepository(Payment));
  }

  findByIds(ids: string[]): Promise<Payment[]> {
    return ids.length ? this.repository.findBy({ id: In(ids) }) : Promise.resolve([]);
  }

  /**
   * Optimistic write: persist the payment's mutable fields only if the row is still at the
   * version the caller read. TypeORM's update builder bumps `version` and `updated_at` itself.
   * Returns the fresh row, or null when another writer got there first.
   */
  async updateIfVersion(
    payment: Payment,
    expectedVersion: number,
  ): Promise<Payment | null> {
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        status: payment.status,
        processedAt: payment.processedAt,
        failureCode: payment.failureCode,
        failureMessage: payment.failureMessage,
        attempts: payment.attempts,
      })
      .where('id = :id AND version = :version', {
        id: payment.id,
        version: expectedVersion,
      })
      .execute();

    return result.affected ? this.findById(payment.id) : null;
  }

  /**
   * Newest first, keyset-paginated: `(created_at, id) < cursor` walks the
   * (created_at, id) / (status, created_at, id) indexes directly, so page N costs the same as
   * page 1 and rows inserted meanwhile never shift what the reader sees.
   */
  async listPage({
    limit,
    after,
    status,
    currency,
    from,
    to,
  }: PageQuery): Promise<PaymentPage> {
    const qb = this.repository
      .createQueryBuilder('p')
      .addSelect(
        `to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        'cursor_created_at',
      )
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .limit(limit + 1);

    if (status) qb.andWhere('p.status = :status', { status });
    if (currency) qb.andWhere('p.currency = :currency', { currency });
    if (from) qb.andWhere('p.created_at >= :from', { from });
    if (to) qb.andWhere('p.created_at < :to', { to });
    if (after) {
      qb.andWhere(
        '(p.created_at, p.id) < (CAST(:afterCreatedAt AS timestamptz), CAST(:afterId AS uuid))',
        { afterCreatedAt: after.createdAt, afterId: after.id },
      );
    }

    const { entities, raw } = await qb.getRawAndEntities<{ cursor_created_at: string }>();
    const items = entities.slice(0, limit);
    const last = items.at(-1);
    const hasMore = entities.length > limit;
    return {
      items,
      next:
        hasMore && last
          ? { createdAt: raw[items.length - 1]?.cursor_created_at ?? '', id: last.id }
          : null,
    };
  }

  /** Whole-table aggregates: fine at demo scale; see README for how this would scale. */
  async aggregates(): Promise<PaymentAggregates> {
    const [counts, volume, timing] = await Promise.all([
      this.repository
        .createQueryBuilder('p')
        .select('p.status', 'status')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('p.status')
        .getRawMany<{ status: PaymentStatus; count: number }>(),
      this.repository
        .createQueryBuilder('p')
        .select('p.currency', 'currency')
        .addSelect('SUM(p.amount)', 'total')
        .where('p.status = :status', { status: PaymentStatus.SUCCEEDED })
        .groupBy('p.currency')
        .getRawMany<{ currency: Currency; total: string }>(),
      this.manager.query<Array<{ p50: number | null; p95: number | null }>>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
         FROM (SELECT EXTRACT(EPOCH FROM (processed_at - created_at)) * 1000 AS ms
               FROM payments WHERE processed_at IS NOT NULL) AS t`,
      ),
    ]);

    const round = (v: number | null | undefined) =>
      v == null ? null : Math.round(Number(v));
    return {
      countsByStatus: counts,
      succeededVolume: volume.map((v) => ({
        currency: v.currency,
        total: Number(v.total),
      })),
      processingTimeMs: { p50: round(timing[0]?.p50), p95: round(timing[0]?.p95) },
    };
  }
}
