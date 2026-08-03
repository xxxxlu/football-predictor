-- 0028 — Epic 12 unified review closeout (stories 12.1/12.3).
--
-- 1. room.messages gets the user-scoped keyset index 0027 gave the channel:
--    the per-send consecutive-duplicate probe (WHERE room_id = $1 AND
--    user_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1) and the persisted
--    rate window otherwise walk the room's whole history row by row on the
--    (room_id, created_at, id) index, inside the write transaction.
-- 2. identity.friend_request_events_requester_time_idx is dropped: 0027's
--    (requester_user_id, kind, occurred_at) index strictly supersedes it —
--    every counting query filters by kind now, and the old b-tree was pure
--    insert overhead.

CREATE INDEX IF NOT EXISTS "room_messages_user_keyset_idx"
  ON "room"."messages" ("room_id", "user_id", "created_at" DESC, "id" DESC);

DROP INDEX IF EXISTS "identity"."friend_request_events_requester_time_idx";
