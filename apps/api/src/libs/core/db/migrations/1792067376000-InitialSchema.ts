import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hand-written rather than generated: every constraint has a deliberate name and the partial
 * indexes are exactly what the queue needs. schema-drift.int-spec.ts proves the entities
 * describe precisely this schema.
 */
export class InitialSchema1792067376000 implements MigrationInterface {
  name = 'InitialSchema1792067376000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "payment_status" AS ENUM
        ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');
      CREATE TYPE "payment_event_type" AS ENUM
        ('payment.created', 'payment.status_changed', 'payment.attempt_failed');
      CREATE TYPE "idempotency_status" AS ENUM ('processing', 'completed');
      CREATE TYPE "job_type" AS ENUM ('process_payment');
      CREATE TYPE "job_status" AS ENUM ('queued', 'running', 'completed', 'failed');

      CREATE TABLE "payments" (
        "id"              uuid           NOT NULL DEFAULT gen_random_uuid(),
        "created_at"      timestamptz    NOT NULL DEFAULT now(),
        "updated_at"      timestamptz    NOT NULL DEFAULT now(),
        "version"         integer        NOT NULL,
        "amount"          bigint         NOT NULL,
        "currency"        character(3)   NOT NULL,
        "status"          payment_status NOT NULL DEFAULT 'PENDING',
        "card_brand"      varchar(20)    NOT NULL,
        "card_last4"      character(4)   NOT NULL,
        "card_exp_month"  smallint       NOT NULL,
        "card_exp_year"   smallint       NOT NULL,
        "customer_email"  varchar(254)   NOT NULL,
        "description"     varchar(255),
        "failure_code"    varchar(40),
        "failure_message" varchar(255),
        "attempts"        integer        NOT NULL DEFAULT 0,
        "processed_at"    timestamptz,
        CONSTRAINT "pk_payments" PRIMARY KEY ("id"),
        CONSTRAINT "chk_payments_amount_positive" CHECK ("amount" > 0)
      );
      CREATE INDEX "idx_payments_created_at_id" ON "payments" ("created_at", "id");
      CREATE INDEX "idx_payments_status_created_at_id" ON "payments" ("status", "created_at", "id");

      CREATE TABLE "payment_events" (
        "id"          uuid               NOT NULL DEFAULT gen_random_uuid(),
        "created_at"  timestamptz        NOT NULL DEFAULT now(),
        "sequence"    bigint             GENERATED ALWAYS AS IDENTITY NOT NULL,
        "payment_id"  uuid               NOT NULL,
        "type"        payment_event_type NOT NULL,
        "from_status" payment_status,
        "to_status"   payment_status,
        "reason"      varchar(500),
        "metadata"    jsonb              NOT NULL DEFAULT '{}',
        CONSTRAINT "pk_payment_events" PRIMARY KEY ("id"),
        CONSTRAINT "uq_payment_events_sequence" UNIQUE ("sequence"),
        CONSTRAINT "fk_payment_events_payment_id" FOREIGN KEY ("payment_id")
          REFERENCES "payments" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "idx_payment_events_payment_id_sequence"
        ON "payment_events" ("payment_id", "sequence");

      CREATE TABLE "idempotency_keys" (
        "key"             varchar(255)       NOT NULL,
        "request_hash"    character(64)      NOT NULL,
        "status"          idempotency_status NOT NULL DEFAULT 'processing',
        "response_status" smallint,
        "response_body"   jsonb,
        "payment_id"      uuid,
        "created_at"      timestamptz        NOT NULL DEFAULT now(),
        "expires_at"      timestamptz        NOT NULL,
        CONSTRAINT "pk_idempotency_keys" PRIMARY KEY ("key"),
        CONSTRAINT "fk_idempotency_keys_payment_id" FOREIGN KEY ("payment_id")
          REFERENCES "payments" ("id") ON DELETE SET NULL
      );
      CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" ("expires_at");

      CREATE TABLE "jobs" (
        "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "type"         job_type    NOT NULL,
        "payment_id"   uuid        NOT NULL,
        "status"       job_status  NOT NULL DEFAULT 'queued',
        "attempts"     integer     NOT NULL DEFAULT 0,
        "max_attempts" integer     NOT NULL DEFAULT 5,
        "run_at"       timestamptz NOT NULL DEFAULT now(),
        "locked_at"    timestamptz,
        "locked_by"    varchar(100),
        "last_error"   text,
        "completed_at" timestamptz,
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_jobs_payment_id" FOREIGN KEY ("payment_id")
          REFERENCES "payments" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "idx_jobs_claimable" ON "jobs" ("run_at") WHERE "status" = 'queued';
      CREATE UNIQUE INDEX "uq_jobs_active_payment" ON "jobs" ("payment_id")
        WHERE "status" IN ('queued', 'running');
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "jobs";
      DROP TABLE "idempotency_keys";
      DROP TABLE "payment_events";
      DROP TABLE "payments";
      DROP TYPE "job_status";
      DROP TYPE "job_type";
      DROP TYPE "idempotency_status";
      DROP TYPE "payment_event_type";
      DROP TYPE "payment_status";
    `);
  }
}
