ALTER TABLE "identity"."sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;
UPDATE "identity"."sessions" SET "last_seen_at" = "created_at" WHERE "last_seen_at" IS NULL;
ALTER TABLE "identity"."sessions" ALTER COLUMN "last_seen_at" SET DEFAULT now();
ALTER TABLE "identity"."sessions" ALTER COLUMN "last_seen_at" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "identity"."reauth_proofs" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "session_token_hash" text NOT NULL REFERENCES "identity"."sessions"("token_hash") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "identity_reauth_proofs_user_expiry_idx" ON "identity"."reauth_proofs" ("user_id", "expires_at");

CREATE TABLE IF NOT EXISTS "identity"."admin_account_audit_events" (
  "audit_id" uuid PRIMARY KEY NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "identity"."users"("id"),
  "target_user_id" uuid NOT NULL REFERENCES "identity"."users"("id"),
  "action" text NOT NULL CHECK ("action" IN ('ACCOUNT_DISABLED','ACCOUNT_RESTORED')),
  "result" text NOT NULL CHECK ("result" IN ('SUCCESS')),
  "occurred_at" timestamptz NOT NULL
);
