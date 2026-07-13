CREATE SCHEMA IF NOT EXISTS "prediction";
CREATE TABLE IF NOT EXISTS "prediction"."tickets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE RESTRICT,
  "market_id" text NOT NULL,
  "fixture_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "stake_points" numeric(20,2) NOT NULL CHECK ("stake_points" > 0 AND "stake_points" <= 20000 AND trunc("stake_points") = "stake_points"),
  "status" text NOT NULL CHECK ("status" IN ('PENDING', 'SETTLED')),
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "prediction_ticket_idempotency_unique" UNIQUE ("user_id", "room_id", "idempotency_key")
);
CREATE INDEX IF NOT EXISTS "prediction_tickets_room_user_idx" ON "prediction"."tickets" ("room_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "prediction_tickets_fixture_idx" ON "prediction"."tickets" ("fixture_id", "status");
CREATE TABLE IF NOT EXISTS "prediction"."legs" (
  "ticket_id" uuid NOT NULL REFERENCES "prediction"."tickets"("id") ON DELETE RESTRICT,
  "leg_number" integer NOT NULL,
  "selection" text NOT NULL CHECK ("selection" IN ('HOME', 'DRAW', 'AWAY')),
  "odds_version" text NOT NULL,
  "decimal_odds" text NOT NULL CHECK ("decimal_odds" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' AND "decimal_odds" !~ '^0+(\.0+)?$'),
  "data_as_of" timestamptz NOT NULL,
  "supplier" text NOT NULL,
  "supplier_fixture_id" integer NOT NULL,
  "bookmaker_id" integer NOT NULL,
  "supplier_market_id" integer NOT NULL,
  PRIMARY KEY ("ticket_id", "leg_number")
);
ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "available_delta_points" numeric(20,2) DEFAULT 0 NOT NULL;
ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "frozen_delta_points" numeric(20,2) DEFAULT 0 NOT NULL;
ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "ticket_id" uuid;
DO $$ BEGIN
  ALTER TABLE "ledger"."entries" ADD CONSTRAINT "ledger_entries_ticket_fk" FOREIGN KEY ("ticket_id") REFERENCES "prediction"."tickets"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ledger_entries_ticket_idx" ON "ledger"."entries" ("ticket_id") WHERE "ticket_id" IS NOT NULL;
