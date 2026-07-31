-- 0026_club_lobby.sql
-- Story 12.4: PULSE CLUB lobby and public channel (FR89). The lobby is not a
-- points room: nothing in the club schema references room, prediction, ledger
-- or supplier relations — every FK below targets identity.users or another
-- club table, which is how "no balances here" is proven rather than promised.

-- ---------------------------------------------------------------------------
-- The one public channel. Messages are IMMUTABLE, like room chat (0025): no
-- edit or delete columns — visibility changes go through moderation state, and
-- message rows are never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "club"."channel_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  -- Code points, same unit the domain validator counts (char_length).
  "body" text NOT NULL CHECK (char_length("body") BETWEEN 1 AND 500),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- One site-wide channel, so the keyset index needs no leading scope column.
CREATE INDEX IF NOT EXISTS "club_channel_messages_keyset_idx"
  ON "club"."channel_messages" ("created_at" DESC, "id" DESC);

-- ---------------------------------------------------------------------------
-- Channel message visibility — mirrors room.message_moderation (0021): hiding
-- is reversible state on top of the message row, never a rewrite of it.
-- ---------------------------------------------------------------------------
-- report_id is a plain uuid on purpose: the governance queue physically lives
-- in the "room" schema (0021), and AC1 forbids any club→room foreign key. The
-- inbox writes both rows in one transaction, and reports are never deleted
-- (RESTRICT everywhere), so referential integrity holds without the constraint.
CREATE TABLE IF NOT EXISTS "club"."channel_message_moderation" (
  "message_id" uuid PRIMARY KEY REFERENCES "club"."channel_messages"("id") ON DELETE RESTRICT,
  "state" text NOT NULL,
  "report_id" uuid,
  "reason" text NOT NULL,
  "hidden_by" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "hidden_at" timestamptz NOT NULL,
  "restored_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "restored_at" timestamptz,
  CONSTRAINT "channel_message_moderation_state_check" CHECK ("state" IN ('HIDDEN','RESTORED')),
  CONSTRAINT "channel_message_moderation_reason_length" CHECK (char_length("reason") BETWEEN 5 AND 500),
  CONSTRAINT "channel_message_moderation_restore_consistent"
    CHECK (("state" = 'RESTORED') = ("restored_at" IS NOT NULL) AND ("restored_at" IS NULL) = ("restored_by" IS NULL))
);

-- ---------------------------------------------------------------------------
-- Community-level mutes. Distinct from room.member_mutes: a room mute is bound
-- to one room; this one silences the single shared channel. muted_until is
-- NOT NULL — the duration still comes from the closed MUTE_DURATION_HOURS
-- list, and anything indefinite remains an account-level USER_SECURITY_WRITE
-- action (the 11.3 boundary).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "club"."channel_mutes" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  -- Plain uuid, same rationale as channel_message_moderation.report_id above.
  "report_id" uuid,
  "reason" text NOT NULL,
  "muted_by" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "muted_at" timestamptz NOT NULL,
  "muted_until" timestamptz NOT NULL,
  "lifted_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "lifted_at" timestamptz,
  CONSTRAINT "channel_mutes_reason_length" CHECK (char_length("reason") BETWEEN 5 AND 500),
  CONSTRAINT "channel_mutes_window_check" CHECK ("muted_until" > "muted_at"),
  -- lifted_at without lifted_by = the window ran out on its own (0021 semantics).
  CONSTRAINT "channel_mutes_lift_consistent" CHECK ("lifted_at" IS NOT NULL OR "lifted_by" IS NULL)
);
-- One live community mute per member; expired windows are closed out
-- (lifted_at := muted_until) before a new one is issued, same as room mutes.
CREATE UNIQUE INDEX IF NOT EXISTS "club_channel_mutes_active_idx"
  ON "club"."channel_mutes" ("user_id") WHERE "lifted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "club_channel_mutes_user_idx"
  ON "club"."channel_mutes" ("user_id", "muted_until" DESC);

-- ---------------------------------------------------------------------------
-- Third, independent presence opt-in: the lobby directory shows the member to
-- every lobby visitor, a wider consent scope than either friend-facing toggle
-- from 0023 — so it is its own column, default OFF (PRD L203).
-- ---------------------------------------------------------------------------
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "show_in_lobby_directory" boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Widen room.reports to carry channel reports (kind CHANNEL_MESSAGE), keeping
-- the one governance inbox instead of forking a second queue. The 0025 foreign
-- key message_id → room.messages is untouched: a channel message gets its own
-- column, because one column cannot reference two tables.
--
-- Deploy note: the CHECK rewrites below validate every existing row. 0021/0025
-- rows satisfy them by construction (ROOM rows have all four message columns
-- NULL; MESSAGE rows have room_id and all four NOT NULL) — the one-off real-DB
-- run for this story re-proves that against seeded history.
-- ---------------------------------------------------------------------------
ALTER TABLE "room"."reports" ALTER COLUMN "room_id" DROP NOT NULL;
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "channel_message_id" uuid;
DO $$ BEGIN
  ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_channel_message_fk"
    FOREIGN KEY ("channel_message_id") REFERENCES "club"."channel_messages"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_kind_check";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_kind_check" CHECK ("kind" IN ('ROOM','MESSAGE','CHANNEL_MESSAGE'));

-- Three branches, each pinning every target column for its kind:
--   ROOM            room_id set,  no message target of either sort
--   MESSAGE         room_id set,  room-message target,   no channel target
--   CHANNEL_MESSAGE no room at all, channel target + the derived snapshot trio
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_kind_target_consistent";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_kind_target_consistent" CHECK (
  ("kind" = 'ROOM' AND "room_id" IS NOT NULL AND "message_id" IS NULL AND "channel_message_id" IS NULL
    AND "subject_user_id" IS NULL AND "reported_excerpt" IS NULL AND "message_sent_at" IS NULL)
  OR ("kind" = 'MESSAGE' AND "room_id" IS NOT NULL AND "message_id" IS NOT NULL AND "channel_message_id" IS NULL
    AND "subject_user_id" IS NOT NULL AND "reported_excerpt" IS NOT NULL AND "message_sent_at" IS NOT NULL)
  OR ("kind" = 'CHANNEL_MESSAGE' AND "room_id" IS NULL AND "message_id" IS NULL AND "channel_message_id" IS NOT NULL
    AND "subject_user_id" IS NOT NULL AND "reported_excerpt" IS NOT NULL AND "message_sent_at" IS NOT NULL)
);

-- One open report per (reporter, channel message) — the 0021 rationale, applied
-- to the channel column.
CREATE UNIQUE INDEX IF NOT EXISTS "room_reports_single_open_channel_idx"
  ON "room"."reports" ("channel_message_id", "reporter_user_id")
  WHERE "kind" = 'CHANNEL_MESSAGE' AND "status" IN ('OPEN','ASSIGNED');
