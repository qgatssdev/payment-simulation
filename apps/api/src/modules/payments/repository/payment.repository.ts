import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { Payment } from '../entity/payment.entity';

export class PaymentRepository extends BaseRepository<Payment> {
  constructor(manager: EntityManager) {
    super(manager.getRepository(Payment));
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
}
