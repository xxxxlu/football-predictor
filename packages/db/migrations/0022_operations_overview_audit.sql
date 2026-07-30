-- Story 11.4 — unified operations overview and permission audit.
--
-- No new tables and no new columns. The overview reads what the existing consoles
-- already read, and the unified audit reads the same three audit tables FR60
-- already requires — this migration only gives those reads the indexes the new
-- filters need (AC3: subject, target, action, result, time and correlation id),
-- and lets the trail address an operational task.
--
-- FR59 is untouched by construction: nothing here can be written to. The only
-- write this story adds is a task retry, which clears a failed job's backoff wait
-- and never touches its payload, its attempt counter, odds, results or any
-- settlement version.

-- ---------------------------------------------------------------------------
-- Audit filter support. Each table already has an occurred_at index for the
-- unfiltered trail; these two dimensions are what an operator narrows by when
-- they are answering "who did this" or "what happened to that".
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "ops_audit_events_actor_idx"
  ON "ops"."audit_events" ("actor_user_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "ops_audit_events_action_idx"
  ON "ops"."audit_events" ("action", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "identity_admin_account_audit_events_actor_idx"
  ON "identity"."admin_account_audit_events" ("actor_user_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "identity_admin_account_audit_events_action_idx"
  ON "identity"."admin_account_audit_events" ("action", "occurred_at" DESC);

-- room.audit_events has carried no index since 0002; the merged trail sorts on
-- occurred_at, so without one every audit read sequentially scans it.
CREATE INDEX IF NOT EXISTS "room_audit_events_occurred_idx"
  ON "room"."audit_events" ("occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "room_audit_events_actor_idx"
  ON "room"."audit_events" ("actor_user_id", "occurred_at" DESC);

-- ---------------------------------------------------------------------------
-- Operational task retry (FR58). A retry is only ever a re-queue, so the trail
-- addresses the job itself: target_type carries 'JOB' alongside the existing
-- 'USER', 'ROOM' and 'REPORT'. The column has no CHECK to widen — this comment
-- records the vocabulary, and packages/domain/src/operations/audit-query.ts is
-- where it is enforced.
-- ---------------------------------------------------------------------------

-- The risk queue lists failed jobs oldest-first so the longest-stuck task is the
-- one an operator sees. The existing (status, available_at) index answers the
-- worker's claim, not this ordering.
CREATE INDEX IF NOT EXISTS "ops_jobs_failed_idx"
  ON "ops"."jobs" ("updated_at" DESC) WHERE "status" = 'FAILED';
