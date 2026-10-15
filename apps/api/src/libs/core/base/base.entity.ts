/**
 * From the nest-template's BaseEntity, split in two and decoupled from any ORM: append-only
 * records (audit events) have an id and a creation time; mutable ones also carry updatedAt and
 * a version that drives optimistic locking (see PaymentRepository.updateIfVersion).
 */
export interface BaseRecord {
  id: string;
  createdAt: Date;
}

export interface VersionedRecord extends BaseRecord {
  updatedAt: Date;
  /** 1 on insert, +1 on every update. */
  version: number;
}
