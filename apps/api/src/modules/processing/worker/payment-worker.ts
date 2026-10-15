import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { PaymentFailureCode, PaymentStatus } from '@payment-sim/shared';
import type { Logger } from '../../../libs/core/logger/logger';
import { requestContext } from '../../../libs/core/logger/request-context';
import type { PaymentService } from '../../payments/services/payment.service';
import type { BackoffPolicy } from '../backoff';
import { backoffDelay } from '../backoff';
import type { Job } from '../entity/job.entity';
import type { JobRepository } from '../repository/job.repository';
import type { PaymentProcessor } from '../services/payment-processor';

export interface PaymentWorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  backoff: BackoffPolicy;
  workerId?: string;
}

export interface PaymentWorkerDeps {
  jobs: JobRepository;
  processor: PaymentProcessor;
  payments: PaymentService;
  logger: Logger;
  clock?: () => Date;
  random?: () => number;
}

/**
 * Pulls due jobs from the Postgres queue and runs up to `concurrency` of them at once.
 * Wakes on a poll interval or immediately on notify() (a payment was just enqueued, or a job
 * finished and freed a slot). Several workers — in this process or other instances — can run
 * against the same table; SKIP LOCKED and lock fencing keep each job with one owner.
 */
export class PaymentWorker {
  readonly workerId: string;
  private readonly clock: () => Date;
  private readonly random: () => number;
  private readonly inFlight = new Set<Promise<void>>();
  private running = false;
  private loopDone: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private lastReclaimAt = 0;

  constructor(
    private readonly deps: PaymentWorkerDeps,
    private readonly options: PaymentWorkerOptions,
  ) {
    this.workerId =
      options.workerId ??
      `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
    this.clock = deps.clock ?? (() => new Date());
    this.random = deps.random ?? Math.random;
  }

  get activeJobs(): number {
    return this.inFlight.size;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.deps.logger.info(
      { workerId: this.workerId, concurrency: this.options.concurrency },
      'worker started',
    );
    this.loopDone = this.loop();
  }

  /** Stop claiming, then wait for in-flight jobs to settle (graceful shutdown). */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.notify();
    await this.loopDone;
    await this.drain();
    this.deps.logger.info({ workerId: this.workerId }, 'worker stopped');
  }

  notify(): void {
    this.wake?.();
  }

  /** Claim as many due jobs as there are free slots and start them. Returns how many started. */
  async tick(): Promise<number> {
    const free = this.options.concurrency - this.inFlight.size;
    if (free <= 0) return 0;

    const jobs = await this.deps.jobs.claimDue(free, this.workerId, this.clock());
    for (const job of jobs) {
      const run: Promise<void> = this.run(job).finally(() => {
        this.inFlight.delete(run);
        this.notify();
      });
      this.inFlight.add(run);
    }
    return jobs.length;
  }

  /** Resolves once every job started so far has settled. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  async reclaimStaleJobs(): Promise<string[]> {
    this.lastReclaimAt = Date.now();
    const cutoff = new Date(this.clock().getTime() - this.options.lockTimeoutMs);
    const reclaimed = await this.deps.jobs.reclaimStale(cutoff);
    if (reclaimed.length > 0) {
      this.deps.logger.warn(
        { jobIds: reclaimed },
        'reclaimed jobs from unresponsive workers',
      );
    }
    return reclaimed;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        if (Date.now() - this.lastReclaimAt >= this.options.lockTimeoutMs / 2) {
          await this.reclaimStaleJobs();
        }
        const started = await this.tick();
        // A full batch suggests more is due; go again without sleeping while slots remain.
        if (started > 0 && this.inFlight.size < this.options.concurrency) continue;
      } catch (err) {
        this.deps.logger.error({ err }, 'worker loop error');
      }
      await this.idle();
    }
  }

  private idle(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, this.options.pollIntervalMs);
      this.wake = done;
    });
  }

  private run(job: Job): Promise<void> {
    return requestContext.run(
      { jobId: job.id, paymentId: job.paymentId, attempt: job.attempts },
      async () => {
        try {
          const outcome = await this.deps.processor.process(job);
          const now = this.clock();
          const applied =
            outcome.kind === 'done'
              ? await this.deps.jobs.complete(job, now)
              : await this.deps.jobs.retryAt(
                  job,
                  new Date(now.getTime() + outcome.delayMs),
                  outcome.error,
                );
          if (!applied) {
            this.deps.logger.warn(
              'job lock was reclaimed by another worker; result discarded',
            );
            return;
          }
          this.deps.logger.debug({ outcome }, 'job settled');
        } catch (err) {
          await this.handleCrash(job, err);
        }
      },
    );
  }

  /** The processor threw something that is not a gateway answer: a bug, the database, ... */
  private async handleCrash(job: Job, err: unknown): Promise<void> {
    this.deps.logger.error({ err }, 'job crashed');
    const message = err instanceof Error ? err.message : String(err);
    const now = this.clock();
    try {
      if (job.attempts < job.maxAttempts) {
        const delayMs = backoffDelay(job.attempts, this.options.backoff, this.random);
        await this.deps.jobs.retryAt(job, new Date(now.getTime() + delayMs), message);
        return;
      }
      if (!(await this.deps.jobs.fail(job, message, now))) return;
      // Out of attempts: don't leave the customer's payment hanging in PROCESSING forever.
      const payment = await this.deps.payments.get(job.paymentId);
      if (payment.status === PaymentStatus.PROCESSING) {
        await this.deps.payments.transition(payment.id, PaymentStatus.FAILED, 'system', {
          reason: 'Processing failed repeatedly',
          metadata: { attempt: job.attempts, error: message },
          mutate: (p) => {
            p.failureCode = PaymentFailureCode.PROCESSING_ERROR;
            p.failureMessage = 'Processing failed repeatedly';
          },
        });
      }
    } catch (settleErr) {
      // Left running: the stale-lock sweep will re-queue it once the lock times out.
      this.deps.logger.error({ err: settleErr }, 'could not settle crashed job');
    }
  }
}
