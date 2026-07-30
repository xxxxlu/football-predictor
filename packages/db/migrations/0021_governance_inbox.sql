-- Story 11.3 — room and community governance inbox.
-- One queue for two kinds of report (FR81, FR83, FR90). room.reports is widened
-- in place rather than replaced, so every existing room report keeps its id and
-- its audit references. The message half of the queue is ready before chat lands
-- (Story 12.3): the reported message is addressed by id, and the foreign key to
-- room.messages is added by the story that creates that table.
--
-- Nothing here can hold a balance, a prediction, a stake or a ledger row. FR59 is
-- untouched: hiding content and muting a member are reversible participation
-- states, never a rewrite of anyone's points or picks.

-- ---------------------------------------------------------------------------
-- Unified report model.
-- ---------------------------------------------------------------------------

-- Existing rows are room reports by definition, so the default backfills them.
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'ROOM';
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_kind_check";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_kind_check" CHECK ("kind" IN ('ROOM','MESSAGE'));

-- Triage priority. Reporters never set it; an operator assigns it (FR90).
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "severity" text NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_severity_check";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_severity_check" CHECK ("severity" IN ('LOW','NORMAL','HIGH'));

-- The reported message and its author. All NULL for a room report.
-- No FK on message_id yet: room.messages does not exist until Story 12.3.
--
-- reported_excerpt is a snapshot of the message as it was when reported. It is
-- what a moderator judges, which means the decision cannot be undermined by a
-- later edit, and — more importantly — moderating one message never requires read
-- access to the conversation it sat in (FR83).
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "message_id" uuid;
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "subject_user_id" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "reported_excerpt" text;
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "message_sent_at" timestamptz;
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_excerpt_length";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_excerpt_length"
  CHECK ("reported_excerpt" IS NULL OR char_length("reported_excerpt") BETWEEN 1 AND 2000);
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_kind_target_consistent";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_kind_target_consistent" CHECK (
  ("kind" = 'ROOM' AND "message_id" IS NULL AND "subject_user_id" IS NULL AND "reported_excerpt" IS NULL AND "message_sent_at" IS NULL)
  OR ("kind" = 'MESSAGE' AND "message_id" IS NOT NULL AND "subject_user_id" IS NOT NULL AND "reported_excerpt" IS NOT NULL AND "message_sent_at" IS NOT NULL)
);

-- Triage ownership. Claiming a report changes nothing a member can see, so it
-- carries no reason and needs no re-authentication — only the duty.
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "assigned_to" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "assigned_at" timestamptz;

-- ASSIGNED joins the state domain; RESOLVED and DISMISSED are terminal. A closed
-- report is never reopened — a new report is filed instead (NFR23).
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_status_check";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_status_check" CHECK ("status" IN ('OPEN','ASSIGNED','RESOLVED','DISMISSED'));
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_assignment_consistent";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_assignment_consistent" CHECK (
  ("status" <> 'ASSIGNED' OR "assigned_to" IS NOT NULL) AND ("assigned_to" IS NULL) = ("assigned_at" IS NULL)
);

-- Operator-authored justification for the disposition. The immutable copy lives
-- in ops.audit_events; this is the operational state the inbox reads back.
ALTER TABLE "room"."reports" ADD COLUMN IF NOT EXISTS "resolution_note" text;
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_resolution_note_length";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_resolution_note_length"
  CHECK ("resolution_note" IS NULL OR char_length("resolution_note") BETWEEN 5 AND 500);
-- A closed report must say who closed it and when.
ALTER TABLE "room"."reports" DROP CONSTRAINT IF EXISTS "reports_closure_consistent";
ALTER TABLE "room"."reports" ADD CONSTRAINT "reports_closure_consistent" CHECK (
  ("status" IN ('RESOLVED','DISMISSED')) = ("resolved_at" IS NOT NULL)
  AND ("resolved_at" IS NULL) = ("resolved_by" IS NULL)
);

-- The inbox pages by kind + status + severity + recency; the assignee filter and
-- the per-subject lookup each get their own narrow index.
CREATE INDEX IF NOT EXISTS "room_reports_inbox_idx"
  ON "room"."reports" ("kind", "status", "severity", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "room_reports_assignee_idx"
  ON "room"."reports" ("assigned_to", "created_at" DESC) WHERE "status" IN ('OPEN','ASSIGNED');
CREATE INDEX IF NOT EXISTS "room_reports_subject_idx"
  ON "room"."reports" ("subject_user_id", "created_at" DESC);
-- One open report per (reporter, message): a second filing would create a second
-- clock on one decision. Room duplicates are still allowed — several members
-- reporting the same room is signal, and moderateRoom resolves them together.
CREATE UNIQUE INDEX IF NOT EXISTS "room_reports_single_open_message_idx"
  ON "room"."reports" ("message_id", "reporter_user_id") WHERE "kind" = 'MESSAGE' AND "status" IN ('OPEN','ASSIGNED');

-- ---------------------------------------------------------------------------
-- Message visibility. Hiding is reversible and never destructive: the message
-- row stays where it is and this table carries the moderation state on top of
-- it, so a restore is a state change rather than a recovery.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "room"."message_moderation" (
  "message_id" uuid PRIMARY KEY,
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE CASCADE,
  "state" text NOT NULL,
  "report_id" uuid REFERENCES "room"."reports"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "hidden_by" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "hidden_at" timestamptz NOT NULL,
  "restored_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "restored_at" timestamptz,
  CONSTRAINT "message_moderation_state_check" CHECK ("state" IN ('HIDDEN','RESTORED')),
  CONSTRAINT "message_moderation_reason_length" CHECK (char_length("reason") BETWEEN 5 AND 500),
  CONSTRAINT "message_moderation_restore_consistent" CHECK (("state" = 'RESTORED') = ("restored_at" IS NOT NULL) AND ("restored_at" IS NULL) = ("restored_by" IS NULL))
);
CREATE INDEX IF NOT EXISTS "room_message_moderation_room_idx"
  ON "room"."message_moderation" ("room_id", "hidden_at" DESC);

-- ---------------------------------------------------------------------------
-- Temporary mutes. muted_until is NOT NULL by design: this surface cannot issue
-- an indefinite silence. A permanent sanction is an account-level action behind
-- USER_SECURITY_WRITE, which is a different duty.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "room"."member_mutes" (
  "id" uuid PRIMARY KEY,
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "report_id" uuid REFERENCES "room"."reports"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "muted_by" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "muted_at" timestamptz NOT NULL,
  "muted_until" timestamptz NOT NULL,
  "lifted_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "lifted_at" timestamptz,
  CONSTRAINT "member_mutes_reason_length" CHECK (char_length("reason") BETWEEN 5 AND 500),
  CONSTRAINT "member_mutes_window_check" CHECK ("muted_until" > "muted_at"),
  -- lifted_at without lifted_by means the window simply ran out: a mute closes
  -- itself, and the row records that nobody had to intervene. An operator lift
  -- always carries both.
  CONSTRAINT "member_mutes_lift_consistent" CHECK ("lifted_at" IS NOT NULL OR "lifted_by" IS NULL)
);
-- At most one live mute per member per room, so two operators cannot stack
-- overlapping windows on the same person. An expired window is closed out
-- (lifted_at := muted_until) before a new one is issued, which is what keeps this
-- index from blocking a legitimate second mute months later.
CREATE UNIQUE INDEX IF NOT EXISTS "room_member_mutes_active_idx"
  ON "room"."member_mutes" ("room_id", "user_id") WHERE "lifted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "room_member_mutes_user_idx"
  ON "room"."member_mutes" ("user_id", "muted_until" DESC);

-- ---------------------------------------------------------------------------
-- Notices to affected users (AC4: every disposition is explained). This is the
-- delivery record, not a message bus: the account's own surface reads it, and
-- the row is written in the same transaction as the disposition so an action can
-- never land without its explanation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ops"."governance_notices" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  "audience_role" text NOT NULL,
  "report_id" uuid REFERENCES "room"."reports"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "audit_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "read_at" timestamptz,
  CONSTRAINT "governance_notices_kind_check" CHECK ("kind" IN ('REPORT_DISMISSED','ROOM_RESTRICTED','ROOM_CLOSED','ROOM_RESTORED','MESSAGE_HIDDEN','MESSAGE_RESTORED','MEMBER_MUTED','MEMBER_UNMUTED')),
  CONSTRAINT "governance_notices_audience_check" CHECK ("audience_role" IN ('SUBJECT','ROOM_OWNER','REPORTER')),
  CONSTRAINT "governance_notices_reason_length" CHECK (char_length("reason") BETWEEN 5 AND 500)
);
CREATE INDEX IF NOT EXISTS "ops_governance_notices_user_idx"
  ON "ops"."governance_notices" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ops_governance_notices_unread_idx"
  ON "ops"."governance_notices" ("user_id") WHERE "read_at" IS NULL;
