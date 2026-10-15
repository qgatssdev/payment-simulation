import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The worker charges a payment after the request that created it has gone, and the card number
 * is never stored, so the payment keeps the gateway's card token instead.
 *
 * Expand-safe for existing rows: add nullable, backfill, then enforce NOT NULL. Payments created
 * before this migration get a token the gateway rejects, so their job fails cleanly instead of
 * charging an unknown card.
 */
export class AddCardToken1792074000000 implements MigrationInterface {
  name = 'AddCardToken1792074000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments" ADD COLUMN "card_token" varchar(64);
      UPDATE "payments" SET "card_token" = 'tok_unavailable' WHERE "card_token" IS NULL;
      ALTER TABLE "payments" ALTER COLUMN "card_token" SET NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "card_token"`);
  }
}
