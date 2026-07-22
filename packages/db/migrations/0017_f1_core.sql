-- Formula 1 core model (§12.4–12.5): entry list, race weekends, sessions,
-- platform-priced markets with versioned odds snapshots, and admin-entered
-- session results. F1 tickets reuse prediction.tickets/legs and the room ledger.
CREATE SCHEMA IF NOT EXISTS "f1";

CREATE TABLE IF NOT EXISTS "f1"."constructors" (
  "key" text PRIMARY KEY,
  "name" text NOT NULL,
  "color" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "f1"."drivers" (
  "code" text PRIMARY KEY CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,3}$'),
  "number" integer NOT NULL CHECK ("number" >= 1),
  "name" text NOT NULL,
  "constructor_key" text NOT NULL REFERENCES "f1"."constructors"("key") ON DELETE RESTRICT,
  "active" boolean NOT NULL DEFAULT true,
  -- Season points feed the deterministic head-to-head pricing formula.
  "season_points" integer NOT NULL DEFAULT 0 CHECK ("season_points" >= 0),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "f1"."race_weekends" (
  "id" uuid PRIMARY KEY,
  "season" integer NOT NULL,
  "round" integer NOT NULL CHECK ("round" >= 1),
  "name" text NOT NULL,
  "circuit_key" text NOT NULL,
  "is_sprint_weekend" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "f1_race_weekends_season_round_unique" UNIQUE ("season", "round")
);

CREATE TABLE IF NOT EXISTS "f1"."sessions" (
  "id" uuid PRIMARY KEY,
  "weekend_id" uuid NOT NULL REFERENCES "f1"."race_weekends"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL CHECK ("kind" IN ('QUALIFYING', 'SPRINT_QUALIFYING', 'SPRINT', 'GRAND_PRIX')),
  -- Predictions lock exactly at session start (Q1 start / lights out).
  "starts_at" timestamptz NOT NULL,
  "state" text NOT NULL DEFAULT 'UPCOMING' CHECK ("state" IN ('UPCOMING', 'LOCKED', 'FINISHED', 'CANCELLED')),
  "result_version" integer CHECK ("result_version" >= 1),
  "result_confirmed" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "f1_sessions_weekend_kind_unique" UNIQUE ("weekend_id", "kind")
);
CREATE INDEX IF NOT EXISTS "f1_sessions_starts_at_idx" ON "f1"."sessions" ("starts_at");

-- Market id is the canonical ticket market id: f1:<session_id>:<KIND>.
CREATE TABLE IF NOT EXISTS "f1"."markets" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^f1:.+:(POLE|WINNER|PODIUM|EXACT_PODIUM|H2H)$'),
  "session_id" uuid NOT NULL REFERENCES "f1"."sessions"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL CHECK ("kind" IN ('POLE', 'WINNER', 'PODIUM', 'EXACT_PODIUM', 'H2H')),
  "status" text NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'CLOSED', 'SETTLED', 'CANCELLED')),
  "current_version" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "f1_markets_session_kind_unique" UNIQUE ("session_id", "kind")
);

-- Immutable versioned odds snapshots; the version referenced by a frozen leg is
-- the settlement evidence, mirroring supplier.odds_snapshots for football.
CREATE TABLE IF NOT EXISTS "f1"."market_odds" (
  "market_id" text NOT NULL REFERENCES "f1"."markets"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "data_as_of" timestamptz NOT NULL,
  "outcomes" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("market_id", "version")
);

-- Admin-entered official classification, versioned so corrections append a new
-- version instead of mutating the confirmed evidence (settled in Phase 3).
CREATE TABLE IF NOT EXISTS "f1"."session_results" (
  "session_id" uuid NOT NULL REFERENCES "f1"."sessions"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL CHECK ("version" >= 1),
  "classification" jsonb NOT NULL,
  "entered_by" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "entered_at" timestamptz NOT NULL,
  "confirmed_at" timestamptz,
  PRIMARY KEY ("session_id", "version")
);

-- F1 legs freeze encoded selection strings (DRV:/PODIUM:/POD3:/H2H:), so the
-- football-only guard from 0015 must widen. Domain code still enforces the exact
-- candidate sets; this remains a shape guardrail only.
ALTER TABLE "prediction"."legs" DROP CONSTRAINT IF EXISTS "legs_selection_check";
ALTER TABLE "prediction"."legs"
  ADD CONSTRAINT "legs_selection_check"
  CHECK ("selection" ~ '^(HOME|DRAW|AWAY|OTHER|[0-9]{1,2}-[0-9]{1,2}|DRV:[A-Z][A-Z0-9]{1,3}|PODIUM:[A-Z][A-Z0-9]{1,3}:(YES|NO)|POD3:[A-Z][A-Z0-9]{1,3}-[A-Z][A-Z0-9]{1,3}-[A-Z][A-Z0-9]{1,3}|H2H:[A-Z][A-Z0-9]{1,3}>[A-Z][A-Z0-9]{1,3})$');
