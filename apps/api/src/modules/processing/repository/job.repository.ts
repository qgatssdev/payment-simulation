import { randomUUID } from 'node:crypto';
import type { PaymentStore, StoreTx } from '../../../infra/store/payment-store';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { ConflictError } from '../../../libs/core/errors';
import type { Job } from '../entity/job.entity';
import { JobStatus, JobType } from '../entity/job.entity';

const ACTIVE = new Set([JobStatus.QUEUED, JobStatus.RUNNING]);
const DEFAULT_MAX_ATTEMPTS = 5;

export class JobRepository extends BaseRepository<'jobs'> {
  constructor(store: PaymentStore, tx?: StoreTx) {
    super(store, 'jobs', tx);
  }

  /**
   * Called inside the transaction that creates the payment, so a payment can never exist
   * without its processing job (and vice versa). At most one active job per payment.
   */
  enqueuePaymentProcessing(paymentId: string, maxAttempts?: number): Promise<Job> {
    return this.write((tx) => {
      if (
        tx.find('jobs', (j) => j.paymentId === paymentId && ACTIVE.has(j.status)).length
      ) {
        throw new ConflictError(
          `Payment ${paymentId} already has an active processing job`,
        );
      }
      const now = this.now();
      const job: Job = {
        id: randomUUID(),
        type: JobType.PROCESS_PAYMENT,
        paymentId,
        status: JobStatus.QUEUED,
        attempts: 0,
        maxAttempts: maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        runAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.put('jobs', job);
      return job;
    });
  }

  findForPayment(paymentId: string): Promise<Job[]> {
    return Promise.resolve(this.reader.find('jobs', (j) => j.paymentId === paymentId));
  }

  /**
   * Claim up to `limit` due jobs for `workerId`, oldest due first. Claims run in serialized
   * transactions, so concurrent workers can never take the same job. The attempt counter is
   * bumped at claim time, so a job that crashes its worker still uses up an attempt and cannot
   * crash-loop forever.
   */
  claimDue(limit: number, workerId: string, now: Date): Promise<Job[]> {
    return this.write((tx) => {
      const due = tx
        .find('jobs', (j) => j.status === JobStatus.QUEUED && j.runAt <= now)
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
        .slice(0, limit);
      return due.map((job) => {
        const claimed: Job = {
          ...job,
          status: JobStatus.RUNNING,
          attempts: job.attempts + 1,
          lockedAt: now,
          lockedBy: workerId,
          updatedAt: now,
        };
        tx.put('jobs', claimed);
        return claimed;
      });
    });
  }

  /**
   * Every settle below is fenced on (status = running, lockedBy = this worker): if the job's
   * lock was reclaimed because this worker looked dead, a late result from it changes nothing.
   * Returns whether the write applied.
   */
  complete(job: Job, now: Date): Promise<boolean> {
    return this.settle(job, now, { status: JobStatus.COMPLETED, completedAt: now });
  }

  retryAt(job: Job, runAt: Date, error: string): Promise<boolean> {
    return this.settle(job, this.now(), {
      status: JobStatus.QUEUED,
      runAt,
      lastError: error,
    });
  }

  fail(job: Job, error: string, now: Date): Promise<boolean> {
    return this.settle(job, now, {
      status: JobStatus.FAILED,
      lastError: error,
      completedAt: now,
    });
  }

  /** Re-queue running jobs whose lock is older than `lockedBefore`. Returns their ids. */
  reclaimStale(lockedBefore: Date): Promise<string[]> {
    return this.write((tx) => {
      const stale = tx.find(
        'jobs',
        (j) =>
          j.status === JobStatus.RUNNING &&
          j.lockedAt !== null &&
          j.lockedAt < lockedBefore,
      );
      for (const job of stale) {
        tx.put('jobs', {
          ...job,
          status: JobStatus.QUEUED,
          lockedAt: null,
          lockedBy: null,
          updatedAt: this.now(),
        });
      }
      return stale.map((j) => j.id);
    });
  }

  private settle(job: Job, now: Date, changes: Partial<Job>): Promise<boolean> {
    return this.write((tx) => {
      const current = tx.get('jobs', job.id);
      if (
        !current ||
        current.status !== JobStatus.RUNNING ||
        current.lockedBy !== job.lockedBy
      ) {
        return false;
      }
      tx.put('jobs', {
        ...current,
        ...changes,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      });
      return true;
    });
  }
}
