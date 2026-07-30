-- Story 11.1 — fine-grained operator duties and the server-side permission gate.
-- Restricted duties live in their own grant table so an operator's reach is a
-- persisted fact, never a front-end assumption. The seeded SUPER_ADMIN pair is
-- untouched: it stays a users flag and is capped at two by a database trigger.

DO $$ BEGIN
  CREATE TYPE "identity"."operator_role" AS ENUM ('OPERATIONS_ADMIN', 'COMMUNITY_MODERATOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "identity"."operator_role_grants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "role" "identity"."operator_role" NOT NULL,
  "granted_by" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "granted_at" timestamptz NOT NULL,
  "revoked_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz,
  CONSTRAINT "identity_operator_role_grants_no_self_grant" CHECK ("granted_by" <> "user_id"),
  CONSTRAINT "identity_operator_role_grants_revocation_complete" CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL))
);

-- At most one live grant per (account, duty); revoked rows stay for the audit
-- trail (NFR23) and a re-grant inserts a new row.
CREATE UNIQUE INDEX IF NOT EXISTS "identity_operator_role_grants_active_idx"
  ON "identity"."operator_role_grants" ("user_id", "role") WHERE "revoked_at" IS NULL;
CREATE INDEX IF NOT EXISTS "identity_operator_role_grants_user_idx"
  ON "identity"."operator_role_grants" ("user_id") WHERE "revoked_at" IS NULL;

-- Role changes join the existing account audit trail. The action check has to be
-- widened rather than replaced, and metadata carries the duty that changed;
-- reads run it through redactAuditMetadata so no credential can leak (FR81).
ALTER TABLE "identity"."admin_account_audit_events"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "identity"."admin_account_audit_events"
  DROP CONSTRAINT IF EXISTS "admin_account_audit_events_action_check";
ALTER TABLE "identity"."admin_account_audit_events"
  ADD CONSTRAINT "admin_account_audit_events_action_check"
  CHECK ("action" IN ('ACCOUNT_DISABLED','ACCOUNT_RESTORED','OPERATOR_ROLE_GRANTED','OPERATOR_ROLE_REVOKED'));
CREATE INDEX IF NOT EXISTS "identity_admin_account_audit_events_occurred_idx"
  ON "identity"."admin_account_audit_events" ("occurred_at" DESC);

-- Keeps the cardinality check below (and the operator roster read) an index-only
-- scan instead of a sequential scan on every registration.
CREATE INDEX IF NOT EXISTS "identity_users_super_admin_idx"
  ON "identity"."users" ("id") WHERE "is_super_admin";

-- FR80: exactly two super-admins. The seed CLI already asserts the pair; this is
-- the database-level backstop so no future code path, migration or manual UPDATE
-- can mint a third one. It only fires when the count would exceed two, so an
-- empty or half-seeded database still seeds normally.
CREATE OR REPLACE FUNCTION "identity"."assert_super_admin_cardinality"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  super_admins integer;
BEGIN
  SELECT COUNT(*) INTO super_admins FROM "identity"."users" WHERE "is_super_admin";
  IF super_admins > 2 THEN
    RAISE EXCEPTION 'super-admin cardinality violated: % accounts hold is_super_admin, at most 2 are allowed', super_admins
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS "identity_users_super_admin_cardinality" ON "identity"."users";
CREATE TRIGGER "identity_users_super_admin_cardinality"
  AFTER INSERT OR UPDATE OF "is_super_admin" ON "identity"."users"
  FOR EACH STATEMENT EXECUTE FUNCTION "identity"."assert_super_admin_cardinality"();
