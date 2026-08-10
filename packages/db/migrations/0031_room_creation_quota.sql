-- 0031 — bound the public lobby and room creation.
--
-- 1. room_owner_creation_idx serves both new guards in room.rooms itself, so
--    no separate event ledger is needed: a created room leaves a permanent row,
--    unlike a friend request (identity.friend_request_events exists precisely
--    because a rejection deletes its row). The active cap reads it filtered by
--    status, the rate window reads it filtered by created_at, and both run
--    inside the creation transaction behind an advisory lock.
-- 2. room_public_discovery_idx is replaced by a keyset-shaped version. The
--    lobby now pages on (created_at, id) and the old three-column b-tree stops
--    one column short of a clean index scan, so it is strictly superseded —
--    the same reasoning that retired friend_request_events_requester_time_idx
--    in 0028. Dropped after the replacement exists so no read is ever unindexed.
--
-- Both indexes are plain CREATE INDEX, not CONCURRENTLY: room.rooms is the
-- smallest table in the product (one row per room, not per message or ticket)
-- and no other 003x migration takes that route either. The deployer should
-- still expect a brief write lock on room.rooms.

CREATE INDEX IF NOT EXISTS "room_owner_creation_idx"
  ON "room"."rooms" ("created_by", "created_at");

CREATE INDEX IF NOT EXISTS "room_public_discovery_keyset_idx"
  ON "room"."rooms" ("visibility", "status", "created_at", "id");

DROP INDEX IF EXISTS "room"."room_public_discovery_idx";
