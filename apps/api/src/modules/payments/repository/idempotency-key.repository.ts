import type { PaymentStore, StoreTx } from '../../../infra/store/payment-store';
import type { IdempotencyKey } from '../entity/idempotency-key.entity';

export type ClaimResult =
  { claimed: true } | { claimed: false; existing: IdempotencyKey };

/** Keyed by the client's idempotency key rather than an id, so not a BaseRepository. */
export class IdempotencyKeyRepository {
  constructor(
    private readonly store: PaymentStore,
    private readonly tx?: StoreTx,
  ) {}

  withTransaction(tx: StoreTx): IdempotencyKeyRepository {
    return new IdempotencyKeyRepository(this.store, tx);
  }

  /**
   * Must run inside the transaction that does the work. Transactions are serialized, so a
   * duplicate request reaches this only after the first one committed (and sees its claim and
   * response) or rolled back (and sees no claim).
   */
  claim(
    key: string,
    requestHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<ClaimResult> {
    return this.inTransaction((tx): ClaimResult => {
      const existing = tx.get('idempotencyKeys', key);
      if (existing && existing.expiresAt > now) return { claimed: false, existing };

      // Absent, or expired and free to be used again.
      tx.put('idempotencyKeys', {
        key,
        requestHash,
        responseStatus: null,
        responseBody: null,
        paymentId: null,
        createdAt: now,
        expiresAt,
      });
      return { claimed: true };
    });
  }

  complete(
    key: string,
    response: { status: number; body: object; paymentId: string },
  ): Promise<void> {
    return this.inTransaction((tx) => {
      const claim = tx.get('idempotencyKeys', key);
      if (!claim)
        throw new Error(`Idempotency key ${key} was not claimed in this transaction`);
      tx.put('idempotencyKeys', {
        ...claim,
        responseStatus: response.status,
        responseBody: response.body,
        paymentId: response.paymentId,
      });
    });
  }

  /** Drop expired keys (at startup), so the file does not grow with every request forever. */
  purgeExpired(now: Date): Promise<number> {
    return this.store.transaction((tx) => {
      const expired = tx.find('idempotencyKeys', (k) => k.expiresAt <= now);
      for (const k of expired) tx.delete('idempotencyKeys', k.key);
      return expired.length;
    });
  }

  /** Claims only make sense inside the unit of work they protect; failures reject. */
  private inTransaction<T>(work: (tx: StoreTx) => T): Promise<T> {
    if (!this.tx) {
      return Promise.reject(
        new Error('IdempotencyKeyRepository must be bound to a transaction'),
      );
    }
    try {
      return Promise.resolve(work(this.tx));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
