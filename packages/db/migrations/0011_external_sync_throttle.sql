CREATE TABLE IF NOT EXISTS "supplier"."external_sync_claims" (
  "sync_key" text PRIMARY KEY,
  "last_attempt_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
