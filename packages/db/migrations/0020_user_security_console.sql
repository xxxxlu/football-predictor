-- Story 11.2 — user security and lifecycle console.
-- Adds the operator side of the anonymization request lifecycle (FR70, FR82,
-- NFR22) and records bulk session revocation in the existing account audit trail.
-- No table here can hold a balance, a prediction or a ledger row: FR59 is
-- untouched, and public-identity removal stays anonymization, never hard delete.

-- A request now exists before it is finished, so completion becomes optional and
-- 'RECEIVED' joins the status domain. Existing self-service rows are already
-- COMPLETED with a completion timestamp, so both changes are backward compatible.
ALTER TABLE "ops"."privacy_requests" ALTER COLUMN "completed_at" DROP NOT NULL;
ALTER TABLE "ops"."privacy_requests" DROP CONSTRAINT IF EXISTS "privacy_requests_status_check";
ALTER TABLE "ops"."privacy_requests"
  ADD CONSTRAINT "privacy_requests_status_check" CHECK ("status" IN ('RECEIVED','COMPLETED'));

-- Who filed it and who closed it. Both are NULL for a self-service request, which
-- the account holder raises and the system completes in the same transaction.
ALTER TABLE "ops"."privacy_requests" ADD COLUMN IF NOT EXISTS "requested_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "ops"."privacy_requests" ADD COLUMN IF NOT EXISTS "handled_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT;
-- Operator-authored justification. The immutable copy lives in ops.audit_events;
-- this one is the operational state the request queue reads.
ALTER TABLE "ops"."privacy_requests" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "ops"."privacy_requests" DROP CONSTRAINT IF EXISTS "privacy_requests_reason_length";
ALTER TABLE "ops"."privacy_requests"
  ADD CONSTRAINT "privacy_requests_reason_length" CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 5 AND 500);
-- A completed request must record when; an open one must not pretend to be closed.
ALTER TABLE "ops"."privacy_requests" DROP CONSTRAINT IF EXISTS "privacy_requests_completion_consistent";
ALTER TABLE "ops"."privacy_requests"
  ADD CONSTRAINT "privacy_requests_completion_consistent" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "ops_privacy_requests_user_requested_idx"
  ON "ops"."privacy_requests" ("user_id", "requested_at" DESC);
-- Drives the "what is due" queue and the NFR22 seven-day service level.
CREATE INDEX IF NOT EXISTS "ops_privacy_requests_open_idx"
  ON "ops"."privacy_requests" ("requested_at") WHERE "status" = 'RECEIVED';
-- At most one open deletion request per account, so a duplicate filing cannot
-- create two competing seven-day clocks.
CREATE UNIQUE INDEX IF NOT EXISTS "ops_privacy_requests_single_open_idx"
  ON "ops"."privacy_requests" ("user_id", "kind") WHERE "status" = 'RECEIVED';

-- Bulk session revocation is an account-security action, so it belongs in the
-- same trail as disable/restore. Widened, not replaced: earlier actions survive.
ALTER TABLE "identity"."admin_account_audit_events"
  DROP CONSTRAINT IF EXISTS "admin_account_audit_events_action_check";
ALTER TABLE "identity"."admin_account_audit_events"
  ADD CONSTRAINT "admin_account_audit_events_action_check"
  CHECK ("action" IN ('ACCOUNT_DISABLED','ACCOUNT_RESTORED','OPERATOR_ROLE_GRANTED','OPERATOR_ROLE_REVOKED','SESSIONS_REVOKED'));
CREATE INDEX IF NOT EXISTS "identity_admin_account_audit_events_target_idx"
  ON "identity"."admin_account_audit_events" ("target_user_id", "occurred_at" DESC);

-- The per-account governance timeline filters ops.audit_events by target; without
-- this it degrades into a full scan as the trail grows (NFR23 keeps 180 days).
CREATE INDEX IF NOT EXISTS "ops_audit_events_target_idx"
  ON "ops"."audit_events" ("target_type", "target_id", "occurred_at" DESC);
