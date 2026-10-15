import type { EntityManager } from 'typeorm';
import { In, LessThan } from 'typeorm';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { Job, JobStatus, JobType } from '../entity/job.entity';

export class JobRepository extends BaseRepository<Job> {
  constructor(manager: EntityManager) {
    super(manager.getRepository(Job));
  }

  /**
   * Called inside the transaction that creates the payment, so a payment can never exist
   * without its processing job (and vice versa): the job row is the outbox.
   */
  enqueuePaymentProcessing(paymentId: string, maxAttempts?: number): Promise<Job> {
    return this.save(
      this.create({
        type: JobType.PROCESS_PAYMENT,
        paymentId,
        ...(maxAttempts ? { maxAttempts } : {}),
      }),
    );
  }

  /**
   * Claim up to `limit` due jobs for `workerId`. FOR UPDATE SKIP LOCKED makes concurrent
   * claimers (other workers, other instances) skip rows someone else is claiming instead of
   * blocking on them or taking them twice. The attempt counter is bumped at claim time, so a
   * job that crashes its worker still uses up an attempt and cannot crash-loop forever.
   */
  claimDue(limit: number, workerId: string, now: Date): Promise<Job[]> {
    return this.manager.transaction(async (manager) => {
      const due = await manager
        .getRepository(Job)
        .createQueryBuilder('job')
        .where('job.status = :status', { status: JobStatus.QUEUED })
        .andWhere('job.runAt <= :now', { now })
        .orderBy('job.runAt', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      if (due.length === 0) return [];

      for (const job of due) {
        job.status = JobStatus.RUNNING;
        job.attempts += 1;
        job.lockedAt = now;
        job.lockedBy = workerId;
      }
      await manager.getRepository(Job).save(due);
      return due;
    });
  }

  /**
   * Every settle below is fenced on (status = running, locked_by = this worker): if the job's
   * lock was reclaimed because this worker looked dead, a late result from it changes nothing.
   * Returns whether the write applied.
   */
  complete(job: Job, now: Date): Promise<boolean> {
    return this.settle(job, {
      status: JobStatus.COMPLETED,
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
    });
  }

  retryAt(job: Job, runAt: Date, error: string): Promise<boolean> {
    return this.settle(job, {
      status: JobStatus.QUEUED,
      runAt,
      lastError: error,
      lockedAt: null,
      lockedBy: null,
    });
  }

  fail(job: Job, error: string, now: Date): Promise<boolean> {
    return this.settle(job, {
      status: JobStatus.FAILED,
      lastError: error,
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
    });
  }

  /** Re-queue running jobs whose worker has gone quiet for longer than the lock timeout. */
  async reclaimStale(lockedBefore: Date): Promise<string[]> {
    const stale = await this.repository.find({
      select: { id: true },
      where: { status: JobStatus.RUNNING, lockedAt: LessThan(lockedBefore) },
    });
    if (stale.length === 0) return [];
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({ status: JobStatus.QUEUED, lockedAt: null, lockedBy: null })
      .where({ id: In(stale.map((j) => j.id)), status: JobStatus.RUNNING })
      .andWhere('locked_at < :lockedBefore', { lockedBefore })
      .returning(['id'])
      .execute();
    return (result.raw as Array<{ id: string }>).map((row) => row.id);
  }

  private async settle(job: Job, changes: Partial<Job>): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set(changes)
      .where('id = :id AND status = :running AND locked_by = :worker', {
        id: job.id,
        running: JobStatus.RUNNING,
        worker: job.lockedBy,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
