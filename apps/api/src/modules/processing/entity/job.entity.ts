import type { BaseRecord } from '../../../libs/core/base/base.entity';

export enum JobType {
  PROCESS_PAYMENT = 'process_payment',
}

export enum JobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * A persisted work queue entry. Queued work survives restarts because it is just a record;
 * claims happen inside serialized store transactions, so two workers can never take the same
 * job, and every settle is fenced on the claiming worker's id.
 */
export interface Job extends BaseRecord {
  type: JobType;
  paymentId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  completedAt: Date | null;
  updatedAt: Date;
}
