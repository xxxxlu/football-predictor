CREATE SCHEMA IF NOT EXISTS "supplier";

CREATE TABLE IF NOT EXISTS "supplier"."request_budgets" (
  "billing_day" date PRIMARY KEY,
  "total_used" integer NOT NULL DEFAULT 0,
  "static_used" integer NOT NULL DEFAULT 0,
  "prematch_odds_used" integer NOT NULL DEFAULT 0,
  "live_used" integer NOT NULL DEFAULT 0,
  "settlement_used" integer NOT NULL DEFAULT 0,
  "supplier_limit" integer,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "supplier_budget_nonnegative" CHECK (
    "total_used" >= 0 AND "static_used" >= 0 AND "prematch_odds_used" >= 0
    AND "live_used" >= 0 AND "settlement_used" >= 0
  ),
  CONSTRAINT "supplier_budget_hard_limit" CHECK ("total_used" <= 95)
);

CREATE TABLE IF NOT EXISTS "supplier"."fixtures" (
  "id" text PRIMARY KEY,
  "supplier" text NOT NULL,
  "supplier_fixture_id" bigint NOT NULL UNIQUE,
  "competition_id" bigint NOT NULL,
  "competition_name" text NOT NULL,
  "season" integer NOT NULL,
  "kickoff_at" timestamptz NOT NULL,
  "status" text NOT NULL,
  "home_team_id" bigint NOT NULL,
  "home_team_name" text NOT NULL,
  "away_team_id" bigint NOT NULL,
  "away_team_name" text NOT NULL,
  "current_version" text NOT NULL,
  "data_as_of" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "etag" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "supplier_fixtures_kickoff_idx" ON "supplier"."fixtures" ("kickoff_at");

CREATE TABLE IF NOT EXISTS "supplier"."fixture_snapshots" (
  "fixture_id" text NOT NULL REFERENCES "supplier"."fixtures"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "data_as_of" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "etag" text NOT NULL,
  "payload" jsonb NOT NULL,
  PRIMARY KEY ("fixture_id", "version")
);

CREATE TABLE IF NOT EXISTS "supplier"."markets" (
  "id" text PRIMARY KEY,
  "fixture_id" text NOT NULL REFERENCES "supplier"."fixtures"("id") ON DELETE CASCADE,
  "status" text NOT NULL CHECK ("status" IN ('OPEN', 'DATA_UNAVAILABLE')),
  "sync_state" text NOT NULL CHECK ("sync_state" IN ('IDLE', 'SYNCING', 'PAUSED', 'FAILED')),
  "supplier" text NOT NULL,
  "supplier_fixture_id" bigint NOT NULL,
  "bookmaker_id" bigint NOT NULL,
  "bookmaker_name" text NOT NULL,
  "supplier_market_id" bigint NOT NULL,
  "market_name" text NOT NULL,
  "current_version" text NOT NULL,
  "data_as_of" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "outcomes" jsonb NOT NULL,
  "source_verified" boolean NOT NULL,
  "etag" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "supplier_market_trace_unique" UNIQUE ("fixture_id", "bookmaker_id", "supplier_market_id")
);
CREATE INDEX IF NOT EXISTS "supplier_markets_fixture_idx" ON "supplier"."markets" ("fixture_id", "updated_at");

CREATE TABLE IF NOT EXISTS "supplier"."odds_snapshots" (
  "market_id" text NOT NULL REFERENCES "supplier"."markets"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "supplier" text NOT NULL,
  "supplier_fixture_id" bigint NOT NULL,
  "bookmaker_id" bigint NOT NULL,
  "bookmaker_name" text NOT NULL,
  "supplier_market_id" bigint NOT NULL,
  "market_name" text NOT NULL,
  "data_as_of" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "outcomes" jsonb NOT NULL,
  "source_verified" boolean NOT NULL,
  "etag" text NOT NULL,
  PRIMARY KEY ("market_id", "version")
);

CREATE TABLE IF NOT EXISTS "supplier"."live_snapshots" (
  "fixture_id" text PRIMARY KEY REFERENCES "supplier"."fixtures"("id") ON DELETE CASCADE,
  "supplier_fixture_id" bigint NOT NULL,
  "home_score" integer NOT NULL,
  "away_score" integer NOT NULL,
  "minute" integer,
  "data_as_of" timestamptz NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "markets" jsonb NOT NULL,
  "etag" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
