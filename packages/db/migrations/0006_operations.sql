ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "nickname" text;
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "is_super_admin" boolean DEFAULT false NOT NULL;
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
ALTER TABLE "identity"."users" ADD CONSTRAINT "identity_users_nickname_length" CHECK ("nickname" IS NULL OR char_length("nickname") BETWEEN 2 AND 32) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS "identity_exactly_named_super_admins" ON "identity"."users" ("username_canonical") WHERE "is_super_admin";

ALTER TABLE "ledger"."entries" ADD COLUMN IF NOT EXISTS "correction_debt_delta_points" numeric(20,2) DEFAULT 0 NOT NULL;
UPDATE "ledger"."entries" SET "available_delta_points" = "amount" WHERE "kind" = 'INITIAL_GRANT' AND "available_delta_points" = 0;

CREATE SCHEMA IF NOT EXISTS "ops";
CREATE TABLE IF NOT EXISTS "ops"."jobs" (
  "id" uuid PRIMARY KEY,
  "kind" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  "available_at" timestamptz NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "last_error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ops_jobs_status_available_idx" ON "ops"."jobs" ("status", "available_at");
