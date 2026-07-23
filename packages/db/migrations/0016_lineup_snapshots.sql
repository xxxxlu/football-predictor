CREATE TABLE IF NOT EXISTS "supplier"."lineup_snapshots" (
  "fixture_id" text PRIMARY KEY REFERENCES "supplier"."fixtures"("id") ON DELETE CASCADE,
  "supplier_fixture_id" bigint NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('CONFIRMED', 'EXPECTED', 'NOT_PUBLISHED', 'UNAVAILABLE')),
  "data_as_of" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "home" jsonb NOT NULL,
  "away" jsonb NOT NULL,
  "etag" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
