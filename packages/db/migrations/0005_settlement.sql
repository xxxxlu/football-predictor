ALTER TABLE "supplier"."fixtures" ADD COLUMN IF NOT EXISTS "result_confirmed" boolean NOT NULL DEFAULT false;
ALTER TABLE "supplier"."fixtures" ADD COLUMN IF NOT EXISTS "home_score" integer;
ALTER TABLE "supplier"."fixtures" ADD COLUMN IF NOT EXISTS "away_score" integer;
ALTER TABLE "supplier"."fixtures" ADD COLUMN IF NOT EXISTS "result_version" text;

CREATE TABLE IF NOT EXISTS "prediction"."settlements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "prediction"."tickets"("id") ON DELETE RESTRICT,
  "settlement_version" text NOT NULL,
  "outcome" text NOT NULL CHECK ("outcome" IN ('WIN','LOSS','PUSH','CANCEL')),
  "gross_return_points" numeric(20,2) NOT NULL,
  "available_delta_points" numeric(20,2) NOT NULL,
  "frozen_delta_points" numeric(20,2) NOT NULL,
  "correction_debt_delta_points" numeric(20,2) NOT NULL,
  "ledger_id" uuid NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE','REVERSED')),
  "settled_at" timestamptz NOT NULL,
  "reversed_at" timestamptz,
  CONSTRAINT "prediction_settlement_version_unique" UNIQUE ("ticket_id", "settlement_version")
);
CREATE INDEX IF NOT EXISTS "prediction_settlements_ticket_idx" ON "prediction"."settlements" ("ticket_id", "settled_at");

ALTER TABLE "prediction"."tickets" ADD COLUMN IF NOT EXISTS "active_settlement_id" uuid;
DO $$ BEGIN
  ALTER TABLE "prediction"."tickets" ADD CONSTRAINT "prediction_ticket_active_settlement_fk"
    FOREIGN KEY ("active_settlement_id") REFERENCES "prediction"."settlements"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "prediction"."settlement_operations" (
  "ticket_id" uuid NOT NULL REFERENCES "prediction"."tickets"("id") ON DELETE RESTRICT,
  "settlement_version" text NOT NULL,
  "operation" text NOT NULL CHECK ("operation" IN ('SETTLE','REVERSAL')),
  "receipt" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("ticket_id", "settlement_version", "operation")
);

ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "correction_debt_delta_points" numeric(20,2) NOT NULL DEFAULT 0;
ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "settlement_version" text;
ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "reverses_ledger_id" uuid;
DO $$ BEGIN
  ALTER TABLE "ledger"."entries" ADD CONSTRAINT "ledger_reverses_entry_fk"
    FOREIGN KEY ("reverses_ledger_id") REFERENCES "ledger"."entries"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
