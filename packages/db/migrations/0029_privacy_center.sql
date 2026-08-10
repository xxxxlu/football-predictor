CREATE SCHEMA IF NOT EXISTS privacy;

DO $$
BEGIN
  CREATE TYPE privacy.data_type AS ENUM ('PHOTO', 'LOCATION', 'DEVICE_INFO', 'PREFERENCES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS privacy.consent (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  data_type privacy.data_type NOT NULL,
  consented boolean NOT NULL DEFAULT false,
  consented_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_consent_user_data_type_unique UNIQUE (user_id, data_type)
);

CREATE INDEX IF NOT EXISTS privacy_consent_user_idx
  ON privacy.consent (user_id);

CREATE TABLE IF NOT EXISTS privacy.collected_data (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  data_type privacy.data_type NOT NULL,
  consent_id uuid NOT NULL REFERENCES privacy.consent(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  collected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_collected_data_user_idx
  ON privacy.collected_data (user_id);

CREATE INDEX IF NOT EXISTS privacy_collected_data_type_idx
  ON privacy.collected_data (data_type);

CREATE INDEX IF NOT EXISTS privacy_collected_data_user_collected_idx
  ON privacy.collected_data (user_id, collected_at DESC);
