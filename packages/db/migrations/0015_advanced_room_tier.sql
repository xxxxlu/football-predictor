DO $$ BEGIN
  CREATE TYPE "public"."room_tier" AS ENUM ('STANDARD', 'ADVANCED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "room"."rooms"
  ADD COLUMN IF NOT EXISTS "tier" "room_tier" NOT NULL DEFAULT 'STANDARD';

-- Correct-score legs store the exact scoreline ("2-1") or the "OTHER" catch-all,
-- so the 1X2-only selection guard from 0003 must widen to cover both markets.
-- The domain still enforces the exact 17-way candidate set; this is only the DB guardrail.
ALTER TABLE "prediction"."legs" DROP CONSTRAINT IF EXISTS "legs_selection_check";
ALTER TABLE "prediction"."legs"
  ADD CONSTRAINT "legs_selection_check"
  CHECK ("selection" ~ '^(HOME|DRAW|AWAY|OTHER|[0-9]{1,2}-[0-9]{1,2})$');
