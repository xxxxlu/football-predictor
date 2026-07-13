CREATE TABLE IF NOT EXISTS "room"."reports" (
  "id" uuid PRIMARY KEY,
  "room_id" uuid NOT NULL REFERENCES "room"."rooms"("id") ON DELETE RESTRICT,
  "reporter_user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "reason" text NOT NULL CHECK (char_length("reason") BETWEEN 10 AND 500),
  "status" text NOT NULL CHECK ("status" IN ('OPEN','RESOLVED')),
  "resolved_by" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "resolution" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "resolved_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "room_reports_status_created_idx" ON "room"."reports" ("status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "ops"."audit_events" (
  "id" uuid PRIMARY KEY,
  "actor_user_id" uuid REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "result" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "ops_audit_events_occurred_idx" ON "ops"."audit_events" ("occurred_at" DESC);

CREATE TABLE IF NOT EXISTS "ops"."privacy_requests" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL CHECK ("kind" IN ('ACCOUNT_DELETION')),
  "status" text NOT NULL CHECK ("status" IN ('COMPLETED')),
  "requested_at" timestamptz NOT NULL,
  "completed_at" timestamptz NOT NULL
);
