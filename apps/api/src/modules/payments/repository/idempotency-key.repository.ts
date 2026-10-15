import type { EntityManager, Repository } from 'typeorm';
import { IdempotencyKey } from '../entity/idempotency-key.entity';

export type ClaimResult =
  { claimed: true } | { claimed: false; existing: IdempotencyKey };

/** Keyed by the client's idempotency key rather than a uuid, so not a BaseRepository. */
export class IdempotencyKeyRepository {
  private readonly repository: Repository<IdempotencyKey>;

  constructor(manager: EntityManager) {
    this.repository = manager.getRepository(IdempotencyKey);
  }

  withTransaction(manager: EntityManager): IdempotencyKeyRepository {
    return new IdempotencyKeyRepository(manager);
  }

  /**
   * Must run inside the transaction that does the work. INSERT ... ON CONFLICT DO NOTHING
   * waits on a concurrent uncommitted insert of the same key, so by the time it reports a
   * conflict the other request has committed and its stored response can be read.
   */
  async claim(
    key: string,
    requestHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<ClaimResult> {
    // An expired key is free to be used again.
    await this.repository
      .createQueryBuilder()
      .delete()
      .where('key = :key AND expires_at <= :now', { key, now })
      .execute();

    const inserted = await this.repository
      .createQueryBuilder()
      .insert()
      .values({ key, requestHash, expiresAt })
      .orIgnore()
      .returning(['key'])
      .execute();
    if (Array.isArray(inserted.raw) && inserted.raw.length > 0) return { claimed: true };

    return { claimed: false, existing: await this.repository.findOneByOrFail({ key }) };
  }

  async complete(
    key: string,
    response: { status: number; body: object; paymentId: string },
  ): Promise<void> {
    await this.repository.update(
      { key },
      {
        responseStatus: response.status,
        responseBody: response.body,
        paymentId: response.paymentId,
      },
    );
  }
}
