import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { Job, JobType } from '../entity/job.entity';

export class JobRepository extends BaseRepository<Job> {
  constructor(manager: EntityManager) {
    super(manager.getRepository(Job));
  }

  /**
   * Called inside the transaction that creates the payment, so a payment can never exist
   * without its processing job (and vice versa): the job row is the outbox.
   */
  enqueuePaymentProcessing(paymentId: string, runAt?: Date): Promise<Job> {
    return this.save(
      this.create({
        type: JobType.PROCESS_PAYMENT,
        paymentId,
        ...(runAt ? { runAt } : {}),
      }),
    );
  }
}
