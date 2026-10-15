import type {
  PaymentCollections,
  PaymentStore,
  StoreTx,
} from '../../../infra/store/payment-store';

type Collection = keyof PaymentCollections;
type Reader = Pick<StoreTx, 'get' | 'find'>;

/**
 * Kept from the nest-template: a thin repository per aggregate, rebindable to a unit of work
 * with withTransaction(tx) so every write in a business operation commits (or rolls back)
 * together. Unbound, each write runs in its own transaction.
 *
 * Deliberately smaller than the template's version: no generic filterBy/orderBy/search taking
 * field names from the caller. Each repository exposes the specific queries it supports.
 */
export abstract class BaseRepository<K extends Collection> {
  protected constructor(
    protected readonly store: PaymentStore,
    protected readonly collection: K,
    protected readonly tx?: StoreTx,
  ) {}

  withTransaction(tx: StoreTx): this {
    const Ctor = this.constructor as new (store: PaymentStore, tx?: StoreTx) => this;
    return new Ctor(this.store, tx);
  }

  /** Inside a bound transaction: its view (including its own writes); else committed state. */
  protected get reader(): Reader {
    return this.tx ?? this.store;
  }

  protected write<T>(work: (tx: StoreTx) => T | Promise<T>): Promise<T> {
    return this.tx ? Promise.resolve(work(this.tx)) : this.store.transaction(work);
  }

  protected now(): Date {
    return this.store.now();
  }

  count(
    predicate?: (record: Readonly<PaymentCollections[K]>) => boolean,
  ): Promise<number> {
    return Promise.resolve(this.reader.find(this.collection, predicate).length);
  }
}
