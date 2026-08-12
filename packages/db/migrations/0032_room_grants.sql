-- 0032_room_grants.sql
-- Story 8.1: request and approve private-room grants (FR43/FR44/FR45).
--
-- One row per member request. The owner's decision lands on the same row in
-- the same transaction as the OWNER_GRANT ledger entry, so a decision can
-- never exist without its explanation and a grant can never exist without a
-- member having asked for it (no request → no grant, the same structural
-- guard as the governance inbox's "every disposition eats a reportId").
--
-- The requester FK targets room.members, not identity.users: leaving a room
-- is impossible today (no leave path exists) and the composite FK makes a
-- request from a non-member unrepresentable — the same shape as
-- ledger.point_accounts.
CREATE TABLE IF NOT EXISTS "room"."grant_requests" (
  "id" uuid PRIMARY KEY,
  "room_id" uuid NOT NULL,
  "requester_user_id" uuid NOT NULL,
  "note" text,
  "status" text NOT NULL DEFAULT 'OPEN',
  "requested_at" timestamp with time zone NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "approved_amount" numeric(20, 2),
  "decision_note" text,
  "ledger_id" uuid,
  CONSTRAINT "grant_requests_member_fk" FOREIGN KEY ("room_id", "requester_user_id")
    REFERENCES "room"."members"("room_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "grant_requests_decided_by_fk" FOREIGN KEY ("decided_by")
    REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "grant_requests_ledger_fk" FOREIGN KEY ("ledger_id")
    REFERENCES "ledger"."entries"("id") ON DELETE RESTRICT,
  CONSTRAINT "grant_requests_status_check" CHECK ("status" IN ('OPEN', 'APPROVED', 'DENIED')),
  -- Note lengths count characters (the app validates by code points before
  -- binding, so the two measures agree; emoji lesson from story 12.2).
  CONSTRAINT "grant_requests_note_length_check" CHECK ("note" IS NULL OR char_length("note") <= 200),
  CONSTRAINT "grant_requests_decision_note_length_check" CHECK ("decision_note" IS NULL OR char_length("decision_note") <= 200),
  -- Whole points, 1..20,000 (aligned with the per-ticket stake ceiling).
  CONSTRAINT "grant_requests_amount_range_check" CHECK ("approved_amount" IS NULL OR ("approved_amount" >= 1 AND "approved_amount" <= 20000 AND "approved_amount" = trunc("approved_amount"))),
  -- A decision and its evidence are one atomic fact:
  --   OPEN     ⇒ nothing decided yet;
  --   APPROVED ⇒ decider, time, amount and ledger row all present;
  --   DENIED   ⇒ decider and time present, no amount, no ledger row.
  CONSTRAINT "grant_requests_closure_consistent" CHECK (
    ("status" = 'OPEN' AND "decided_by" IS NULL AND "decided_at" IS NULL AND "approved_amount" IS NULL AND "decision_note" IS NULL AND "ledger_id" IS NULL)
    OR ("status" = 'APPROVED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "approved_amount" IS NOT NULL AND "ledger_id" IS NOT NULL)
    OR ("status" = 'DENIED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "approved_amount" IS NULL AND "ledger_id" IS NULL)
  )
);

-- One undecided request per member per room; the partial unique index is the
-- final arbiter under concurrency (same recipe as ops.privacy_requests).
CREATE UNIQUE INDEX IF NOT EXISTS "grant_requests_open_unique"
  ON "room"."grant_requests" ("room_id", "requester_user_id") WHERE "status" = 'OPEN';

-- Serves the member-visible list (approved history) and the owner queue.
CREATE INDEX IF NOT EXISTS "grant_requests_room_status_idx"
  ON "room"."grant_requests" ("room_id", "status", "requested_at" DESC);
