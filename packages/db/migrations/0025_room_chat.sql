-- 0025_room_chat.sql
-- Story 12.3: member-protected room public chat (FR88) + the deferred-work
-- closure items from 11.3. Messages are IMMUTABLE: no edit or delete columns —
-- visibility changes go through the existing room.message_moderation table and
-- message rows are never deleted.

CREATE TABLE IF NOT EXISTS "room"."messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE RESTRICT,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  -- Code points, same unit the domain validator counts (char_length).
  "body" text NOT NULL CHECK (char_length("body") BETWEEN 1 AND 500),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Serves keyset pagination: WHERE (created_at, id) < (cursor) ORDER BY both DESC.
CREATE INDEX IF NOT EXISTS "room_messages_keyset_idx"
  ON "room"."messages" ("room_id", "created_at" DESC, "id" DESC);

-- One pinned message per room, held on the room row itself.
ALTER TABLE "room"."rooms" ADD COLUMN IF NOT EXISTS "pinned_message_id" uuid;
ALTER TABLE "room"."rooms" ADD COLUMN IF NOT EXISTS "pinned_by" uuid;
ALTER TABLE "room"."rooms" ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz;
DO $$ BEGIN
  ALTER TABLE "room"."rooms" ADD CONSTRAINT "rooms_pinned_message_fk"
    FOREIGN KEY ("pinned_message_id") REFERENCES "room"."messages"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "room"."rooms" ADD CONSTRAINT "rooms_pinned_by_fk"
    FOREIGN KEY ("pinned_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Deferred-work closure ①/③ (0021 left this to Story 12.3): message reports now
-- reference a real message row. Production has no MESSAGE reports yet (the write
-- path had no public route), so the validating scan is over an empty set — the
-- deploy runbook still confirms `SELECT count(*) FROM room.reports WHERE
-- kind='MESSAGE'` is zero before running this file.
DO $$ BEGIN
  ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_message_fk"
    FOREIGN KEY ("message_id") REFERENCES "room"."messages"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- room.member_mutes.report_id is already nullable in 0021 (owner mutes carry
-- report_id IS NULL) — asserted by schema tests, nothing to change here.
