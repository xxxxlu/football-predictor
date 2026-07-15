DO $$ BEGIN
  CREATE TYPE "public"."room_visibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "room"."rooms"
  ADD COLUMN IF NOT EXISTS "visibility" "room_visibility" NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE "room"."rooms"
  ALTER COLUMN "invite_token_hash" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "room_public_discovery_idx"
  ON "room"."rooms" ("visibility", "status", "created_at");
