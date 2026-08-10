-- 0030_user_avatar.sql
-- Story 12.6: member avatars.
--
-- The database stores metadata and the object-storage handle. It never stores
-- image bytes: no bytea column, no base64 text column, and nothing here writes
-- to privacy.collected_data (the avatar audit note is one metadata row written
-- by the application through the existing 0029 path).
--
-- Physically isolated from the reward side, same rule as 0023: no FK, column or
-- trigger below touches room/prediction/ledger/settlement relations.

-- One avatar per account. The primary key IS the user id, so "replace" is an
-- UPDATE and the one-avatar rule needs no extra constraint.
CREATE TABLE IF NOT EXISTS "identity"."user_avatars" (
  "user_id" uuid PRIMARY KEY,
  -- The handle the public media URL is built from. Random, stable across
  -- replacements, and deliberately NOT the object key: the storage path never
  -- reaches a client.
  "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "file_id" text NOT NULL,
  "object_key" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "moderation_status" text NOT NULL DEFAULT 'APPROVED',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_avatars_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_avatars_public_id_unique" UNIQUE ("public_id"),
  CONSTRAINT "user_avatars_object_key_unique" UNIQUE ("object_key"),
  -- Every avatar is re-encoded server-side, so exactly one output type is legal.
  CONSTRAINT "user_avatars_content_type_check" CHECK ("content_type" = 'image/webp'),
  -- Upper bound matches the pipeline's hard ceiling (512 KiB); a stored row can
  -- never claim a size the endpoint would have refused.
  CONSTRAINT "user_avatars_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 524288),
  -- Square is the product rule (1:1 crop), enforced here rather than trusted.
  CONSTRAINT "user_avatars_dimensions_check" CHECK (
    "width" BETWEEN 64 AND 1024 AND "height" BETWEEN 64 AND 1024 AND "width" = "height"),
  CONSTRAINT "user_avatars_version_check" CHECK ("version" >= 1),
  CONSTRAINT "user_avatars_moderation_status_check" CHECK ("moderation_status" IN ('APPROVED', 'PENDING', 'REMOVED')),
  -- The object key may only ever be two random segments plus a version. A
  -- nickname, a PULSE ID, a phone number or an original filename cannot be
  -- smuggled into the storage path even by a future caller that tries.
  CONSTRAINT "user_avatars_object_key_shape_check" CHECK (
    "object_key" ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+\.webp$')
);

CREATE INDEX IF NOT EXISTS "user_avatars_moderation_idx"
  ON "identity"."user_avatars" ("moderation_status");

-- Replacing an avatar must move the version forward, and the public handle must
-- stay put — otherwise a stale immutable cache entry could be re-pointed at new
-- bytes, or a live URL could be silently re-assigned.
CREATE OR REPLACE FUNCTION "identity"."user_avatars_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."version" <= OLD."version" THEN
    RAISE EXCEPTION 'avatar version must increase (had %, got %)', OLD."version", NEW."version"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."public_id" <> OLD."public_id" THEN
    RAISE EXCEPTION 'avatar public_id is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "user_avatars_guard" ON "identity"."user_avatars";
CREATE TRIGGER "user_avatars_guard"
  BEFORE UPDATE ON "identity"."user_avatars"
  FOR EACH ROW EXECUTE FUNCTION "identity"."user_avatars_guard"();

-- Persisted change quota (5/h, 20/d). Same design as the 0027 social-write
-- ledger: attempts are recorded in their own committed transaction before the
-- work is priced, so a refused or failed upload still costs its unit and probing
-- is never free.
CREATE TABLE IF NOT EXISTS "identity"."avatar_change_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "avatar_change_events_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "avatar_change_events_user_time_idx"
  ON "identity"."avatar_change_events" ("user_id", "occurred_at");

-- Object-storage deletions that still have to happen: a replaced predecessor, a
-- deleted avatar, or the avatar of an account whose public identity was removed.
--
-- Deliberately NO user_id and NO foreign key. This queue's whole purpose is to
-- outlive the row that referenced the object — an account deletion that only
-- dropped the database reference would leave the image readable in the bucket
-- forever.
CREATE TABLE IF NOT EXISTS "identity"."avatar_object_deletions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "object_key" text NOT NULL,
  "file_id" text,
  "enqueued_at" timestamp with time zone NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0,
  "last_attempt_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "avatar_object_deletions_object_key_unique" UNIQUE ("object_key"),
  CONSTRAINT "avatar_object_deletions_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX IF NOT EXISTS "avatar_object_deletions_pending_idx"
  ON "identity"."avatar_object_deletions" ("enqueued_at")
  WHERE "deleted_at" IS NULL;

-- Removing an avatar for a policy violation is an account-security action, so it
-- joins the existing admin account audit vocabulary rather than starting a new
-- store. Widened, never replaced: every action 0019/0020 added survives.
ALTER TABLE "identity"."admin_account_audit_events"
  DROP CONSTRAINT IF EXISTS "admin_account_audit_events_action_check";
ALTER TABLE "identity"."admin_account_audit_events"
  ADD CONSTRAINT "admin_account_audit_events_action_check"
  CHECK ("action" IN ('ACCOUNT_DISABLED','ACCOUNT_RESTORED','OPERATOR_ROLE_GRANTED','OPERATOR_ROLE_REVOKED','SESSIONS_REVOKED','AVATAR_REMOVED'));
