import { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../libs/core/base/base.entity';
import { bigintTransformer } from '../../../libs/core/db/transformers';
import { Payment } from './payment.entity';

/**
 * Append-only audit log: one row per lifecycle fact (created, status changed, attempt failed).
 * Written in the same transaction as the change it records, so the log can never disagree
 * with the payment row.
 */
@Entity('payment_events')
@Index('idx_payment_events_payment_id_sequence', ['paymentId', 'sequence'])
export class PaymentEvent extends BaseEntity {
  /**
   * Database-assigned, strictly increasing across all events. Timestamps can tie within a
   * transaction; this cannot, so it orders the timeline and serves as the SSE event id that
   * clients resume from (Last-Event-ID).
   */
  @Column({
    type: 'bigint',
    generated: 'identity',
    generatedIdentity: 'ALWAYS',
    unique: true,
    transformer: bigintTransformer,
  })
  sequence!: number;

  @Column({ type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;

  @Column({ type: 'enum', enum: PaymentEventType, enumName: 'payment_event_type' })
  type!: PaymentEventType;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    nullable: true,
  })
  fromStatus!: PaymentStatus | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    nullable: true,
  })
  toStatus!: PaymentStatus | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;
}
