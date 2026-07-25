DO $$ BEGIN
  CREATE TYPE "public"."room_sport" AS ENUM ('FOOTBALL', 'FORMULA_1');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "room"."rooms"
  ADD COLUMN IF NOT EXISTS "sport" "room_sport" NOT NULL DEFAULT 'FOOTBALL';

-- Backfill: a room whose submitted tickets are exclusively F1 sessions
-- (fixture_id 'f1:<sessionId>') is an F1 room. Mixed or football-only rooms
-- stay FOOTBALL; their existing F1 tickets remain visible in history views,
-- but new submissions must match the room sport from now on.
UPDATE "room"."rooms" r
SET "sport" = 'FORMULA_1'
WHERE EXISTS (
  SELECT 1 FROM "prediction"."tickets" t
  WHERE t."room_id" = r."id" AND t."fixture_id" LIKE 'f1:%'
) AND NOT EXISTS (
  SELECT 1 FROM "prediction"."tickets" t
  WHERE t."room_id" = r."id" AND t."fixture_id" NOT LIKE 'f1:%'
);
