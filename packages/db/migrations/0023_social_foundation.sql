-- 0023_social_foundation.sql
-- Story 12.1: friends, privacy and presence foundation (Epic 12 PULSE CLUB).
-- Everything lives in the identity schema and is physically isolated from
-- room/prediction/settlement tables: no FK, no column, no trigger touches them.

-- One row per user pair, stored in canonical order so the unique constraint is
-- the final arbiter against duplicate/concurrent relationships (FR84).
CREATE TABLE IF NOT EXISTS "identity"."friendships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_lo_id" uuid NOT NULL,
  "user_hi_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "requested_by" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "responded_at" timestamp with time zone,
  CONSTRAINT "friendships_user_lo_fk" FOREIGN KEY ("user_lo_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "friendships_user_hi_fk" FOREIGN KEY ("user_hi_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "friendships_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "friendships_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED')),
  CONSTRAINT "friendships_canonical_pair_check" CHECK ("user_lo_id" < "user_hi_id"),
  CONSTRAINT "friendships_requester_in_pair_check" CHECK ("requested_by" IN ("user_lo_id", "user_hi_id")),
  CONSTRAINT "friendships_responded_at_check" CHECK (("status" = 'ACCEPTED') = ("responded_at" IS NOT NULL)),
  CONSTRAINT "friendships_pair_unique" UNIQUE ("user_lo_id", "user_hi_id")
);

CREATE INDEX IF NOT EXISTS "friendships_user_hi_idx" ON "identity"."friendships" ("user_hi_id");

-- Directional blocks. A block in either direction outranks every friendship
-- action and never reveals itself to the blocked side (FR84, AC2).
CREATE TABLE IF NOT EXISTS "identity"."user_blocks" (
  "blocker_user_id" uuid NOT NULL,
  "blocked_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_blocks_pk" PRIMARY KEY ("blocker_user_id", "blocked_user_id"),
  CONSTRAINT "user_blocks_blocker_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_blocks_blocked_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_blocks_no_self_check" CHECK ("blocker_user_id" <> "blocked_user_id")
);

CREATE INDEX IF NOT EXISTS "user_blocks_blocked_idx" ON "identity"."user_blocks" ("blocked_user_id");

-- Privacy-first presence toggles: OFF by default at the database layer (FR85).
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "show_online_to_friends" boolean NOT NULL DEFAULT false;
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "show_lobby_to_friends" boolean NOT NULL DEFAULT false;

-- Heartbeat signals filtered by TTL at read time. `lobby_beat_at` is reserved
-- for Story 12.4; `identity.sessions.last_seen_at` must never back presence.
CREATE TABLE IF NOT EXISTS "identity"."presence_signals" (
  "user_id" uuid PRIMARY KEY,
  "online_beat_at" timestamp with time zone,
  "lobby_beat_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "presence_signals_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);

-- Persisted counting window for friend-request rate limiting (10/h, 50/d) —
-- survives process restarts, unlike an in-memory counter.
CREATE TABLE IF NOT EXISTS "identity"."friend_request_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requester_user_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "friend_request_events_requester_fk" FOREIGN KEY ("requester_user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "friend_request_events_requester_time_idx"
  ON "identity"."friend_request_events" ("requester_user_id", "occurred_at");
