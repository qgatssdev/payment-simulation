import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Payment } from './payment.entity';

export enum IdempotencyStatus {
  /** Claimed by an in-flight request; a concurrent duplicate gets 409. */
  PROCESSING = 'processing',
  /** Response stored; duplicates replay it verbatim. */
  COMPLETED = 'completed',
}

@Entity('idempotency_keys')
@Index('idx_idempotency_keys_expires_at', ['expiresAt'])
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key!: string;

  /** SHA-256 of method, path and canonical body: the same key with a different request is a client bug. */
  @Column({ type: 'char', length: 64 })
  requestHash!: string;

  @Column({
    type: 'enum',
    enum: IdempotencyStatus,
    enumName: 'idempotency_status',
    default: IdempotencyStatus.PROCESSING,
  })
  status!: IdempotencyStatus;

  @Column({ type: 'smallint', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  responseBody!: unknown;

  @Column({ type: 'uuid', nullable: true })
  paymentId!: string | null;

  @ManyToOne(() => Payment, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
