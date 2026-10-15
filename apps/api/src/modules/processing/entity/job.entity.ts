import { Column, Entity, Index, JoinColumn, ManyToOne, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from '../../../libs/core/base/base.entity';
import { Payment } from '../../payments/entity/payment.entity';

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
 * A Postgres-backed work queue. Workers claim due rows with FOR UPDATE SKIP LOCKED, so several
 * workers (or API instances) can poll concurrently without double-processing, and queued work
 * survives restarts because it is just rows.
 */
@Entity('jobs')
// The claim query's hot path: only queued rows, ordered by when they become due.
@Index('idx_jobs_claimable', ['runAt'], { where: `"status" = 'queued'` })
// At most one active job per payment, enforced by the database rather than by convention.
@Index('uq_jobs_active_payment', ['paymentId'], {
  unique: true,
  where: `"status" IN ('queued', 'running')`,
})
export class Job extends BaseEntity {
  @Column({ type: 'enum', enum: JobType, enumName: 'job_type' })
  type!: JobType;

  @Column({ type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;

  @Column({
    type: 'enum',
    enum: JobStatus,
    enumName: 'job_status',
    default: JobStatus.QUEUED,
  })
  status!: JobStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  runAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lockedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
