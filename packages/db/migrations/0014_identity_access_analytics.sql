DO $$ BEGIN
  CREATE TYPE "public"."identity_access_event_kind" AS ENUM ('REGISTER', 'LOGIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "identity"."access_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "kind" "identity_access_event_kind" NOT NULL,
  "ip_address" text NOT NULL,
  "country_code" text,
  "region" text,
  "city" text,
  "timezone" text,
  "user_agent" text,
  "accept_language" text,
  "device_class" text,
  "os" text,
  "browser" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "identity_access_events_user_time_idx" ON "identity"."access_events" ("user_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "identity_access_events_country_time_idx" ON "identity"."access_events" ("country_code", "occurred_at");
