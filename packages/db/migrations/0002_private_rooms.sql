CREATE SCHEMA IF NOT EXISTS "room";
CREATE SCHEMA IF NOT EXISTS "ledger";
DO $$ BEGIN CREATE TYPE "public"."room_status" AS ENUM ('ACTIVE', 'RESTRICTED', 'CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."room_role" AS ENUM ('OWNER', 'MEMBER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "room"."rooms" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL CHECK (char_length("name") BETWEEN 2 AND 80),
  "status" "room_status" DEFAULT 'ACTIVE' NOT NULL,
  "invite_token_hash" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "identity"."users"("id"),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "room_invite_token_hash_unique" UNIQUE ("invite_token_hash")
);
CREATE TABLE IF NOT EXISTS "room"."members" (
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "role" "room_role" NOT NULL,
  "accepted_rules_version" text NOT NULL,
  "accepted_rules_at" timestamptz NOT NULL,
  "joined_at" timestamptz NOT NULL,
  PRIMARY KEY ("room_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "room_members_user_idx" ON "room"."members" ("user_id");

CREATE TABLE IF NOT EXISTS "ledger"."point_accounts" (
  "room_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "available_points" numeric(20,2) DEFAULT 0 NOT NULL,
  "frozen_points" numeric(20,2) DEFAULT 0 NOT NULL,
  "correction_debt" numeric(20,2) DEFAULT 0 NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("room_id", "user_id"),
  FOREIGN KEY ("room_id", "user_id") REFERENCES "room"."members"("room_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "point_accounts_nonnegative" CHECK ("available_points" >= 0 AND "frozen_points" >= 0 AND "correction_debt" >= 0)
);
CREATE TABLE IF NOT EXISTS "ledger"."entries" (
  "id" uuid PRIMARY KEY NOT NULL,
  "room_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "amount" numeric(20,2) NOT NULL,
  "idempotency_key" text NOT NULL,
  "audit_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  FOREIGN KEY ("room_id", "user_id") REFERENCES "ledger"."point_accounts"("room_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "ledger_entries_idempotency_unique" UNIQUE ("idempotency_key")
);
CREATE INDEX IF NOT EXISTS "ledger_entries_account_idx" ON "ledger"."entries" ("room_id", "user_id", "created_at");
CREATE TABLE IF NOT EXISTS "room"."audit_events" (
  "audit_id" uuid PRIMARY KEY NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "identity"."users"("id"),
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "result" text NOT NULL,
  "occurred_at" timestamptz NOT NULL
);
