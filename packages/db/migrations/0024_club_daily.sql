-- 0024_club_daily.sql
-- Story 12.2: daily sports challenge + engagement profile + badges (Epic 12).
-- New `club` schema per docs/adr/0001-club-schema.md. Physical isolation is the
-- core acceptance: every FK targets identity.users and nothing else — no
-- room/prediction/ledger reference columns, and no numeric(20,2) anywhere
-- (XP is an integer engagement counter, never a point amount).
CREATE SCHEMA IF NOT EXISTS "club";

-- One official attempt per user per product day; the unique constraint — not
-- application code — is the final arbiter (AC1). The question, answers and
-- rule versions are recorded with the attempt so scoring stays auditable.
CREATE TABLE IF NOT EXISTS "club"."daily_challenge_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "product_day" date NOT NULL,
  "question_key" text NOT NULL,
  "bank_version" integer NOT NULL CHECK ("bank_version" >= 1),
  "xp_rules_version" integer NOT NULL CHECK ("xp_rules_version" >= 1),
  "answer" text NOT NULL CHECK ("answer" IN ('A', 'B', 'C', 'D')),
  "is_correct" boolean NOT NULL,
  "xp_awarded" integer NOT NULL CHECK ("xp_awarded" >= 0),
  "streak_after" integer NOT NULL CHECK ("streak_after" >= 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "daily_challenge_attempts_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "daily_challenge_attempts_one_per_day" UNIQUE ("user_id", "product_day")
);

CREATE INDEX IF NOT EXISTS "daily_challenge_attempts_day_idx"
  ON "club"."daily_challenge_attempts" ("product_day");

-- Aggregated engagement state, updated in the same transaction as the attempt.
CREATE TABLE IF NOT EXISTS "club"."engagement_profiles" (
  "user_id" uuid PRIMARY KEY,
  "xp_total" integer NOT NULL DEFAULT 0 CHECK ("xp_total" >= 0),
  "current_streak" integer NOT NULL DEFAULT 0 CHECK ("current_streak" >= 0),
  "best_streak" integer NOT NULL DEFAULT 0 CHECK ("best_streak" >= 0),
  "last_answered_day" date,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "engagement_profiles_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);

-- Badges are a closed enum pinned by CHECK; (user, badge) unique makes grants
-- idempotent under ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS "club"."badge_awards" (
  "user_id" uuid NOT NULL,
  "badge_key" text NOT NULL CHECK ("badge_key" IN ('FIRST_ANSWER', 'STREAK_7', 'STREAK_30')),
  "awarded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "badge_awards_pk" PRIMARY KEY ("user_id", "badge_key"),
  CONSTRAINT "badge_awards_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);
