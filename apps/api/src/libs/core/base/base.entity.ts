import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * From the nest-template's BaseEntity, split in two: append-only rows (audit events) need an
 * id and a creation time, but no updatedAt or version.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Mutable aggregates. `version` is bumped on every save and drives optimistic locking:
 * updates are conditional on the version the writer read (see PaymentRepository).
 */
export abstract class VersionedEntity extends BaseEntity {
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @VersionColumn()
  version!: number;
}
