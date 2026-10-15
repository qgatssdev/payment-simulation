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

/**
 * The key is claimed (inserted) as the first statement of the transaction that creates the
 * payment, and its response is filled in before that transaction commits. A concurrent request
 * with the same key blocks on the primary key until the first commits, then replays the stored
 * response; if the first rolls back, the second proceeds. So no committed row is ever "in
 * progress" and the response columns are only null inside the claiming transaction.
 */
@Entity('idempotency_keys')
@Index('idx_idempotency_keys_expires_at', ['expiresAt'])
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key!: string;

  /** SHA-256 of the normalised request: the same key with a different request is a client bug. */
  @Column({ type: 'char', length: 64 })
  requestHash!: string;

  @Column({ type: 'smallint', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  responseBody!: object | null;

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
