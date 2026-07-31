-- 0027 — Epic 12 review hardening (stories 12.1/12.4).
--
-- 1. identity.friend_request_events grows a `kind` column: the same persisted
--    quota ledger now also throttles block creation (POST /blocks resolves a
--    PULSE ID too, so unthrottled it was a free existence oracle around the
--    friend-request limit). Existing rows are friend requests — the DEFAULT
--    backfills them, no data rewrite.
-- 2. club.channel_messages gets a user-scoped keyset index: the per-send
--    consecutive-duplicate probe (WHERE user_id = $1 ORDER BY created_at DESC,
--    id DESC LIMIT 1) otherwise walks the whole append-only channel history
--    for every first-time sender, inside the write transaction.

ALTER TABLE "identity"."friend_request_events"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'FRIEND_REQUEST';

DO $$
BEGIN
  ALTER TABLE "identity"."friend_request_events"
    ADD CONSTRAINT "friend_request_events_kind_check"
    CHECK ("kind" IN ('FRIEND_REQUEST', 'BLOCK'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The quota window filters by kind; keep the counting query on one index.
CREATE INDEX IF NOT EXISTS "friend_request_events_requester_kind_time_idx"
  ON "identity"."friend_request_events" ("requester_user_id", "kind", "occurred_at");

CREATE INDEX IF NOT EXISTS "channel_messages_user_keyset_idx"
  ON "club"."channel_messages" ("user_id", "created_at" DESC, "id" DESC);
