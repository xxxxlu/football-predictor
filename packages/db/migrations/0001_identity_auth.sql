CREATE SCHEMA IF NOT EXISTS "identity";
DO $$ BEGIN
  CREATE TYPE "public"."identity_account_status" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."identity_auth_attempt_kind" AS ENUM ('LOGIN', 'RECOVERY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "identity"."users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "username_canonical" text NOT NULL,
  "password_hash" text NOT NULL,
  "recovery_code_hash" text NOT NULL,
  "status" "identity_account_status" DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "identity_users_username_unique" UNIQUE ("username_canonical")
);
CREATE TABLE IF NOT EXISTS "identity"."rule_acceptances" (
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "rules_version" text NOT NULL,
  "is_adult_confirmed" boolean NOT NULL,
  "accepted_at" timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "rules_version")
);
CREATE TABLE IF NOT EXISTS "identity"."sessions" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "identity_sessions_user_idx" ON "identity"."sessions" ("user_id");
CREATE TABLE IF NOT EXISTS "identity"."auth_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "identity_auth_attempt_kind" NOT NULL,
  "account_key" text NOT NULL,
  "source_key" text NOT NULL,
  "occurred_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "identity_auth_attempt_account_idx" ON "identity"."auth_attempts" ("kind", "account_key", "occurred_at");
CREATE INDEX IF NOT EXISTS "identity_auth_attempt_source_idx" ON "identity"."auth_attempts" ("kind", "source_key", "occurred_at");
CREATE TABLE IF NOT EXISTS "identity"."security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "account_key" text NOT NULL,
  "source_key" text NOT NULL,
  "occurred_at" timestamptz NOT NULL
);
