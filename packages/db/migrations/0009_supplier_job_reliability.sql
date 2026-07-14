ALTER TABLE "ops"."jobs" ADD COLUMN IF NOT EXISTS "job_key" text;
ALTER TABLE "ops"."jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "ops"."jobs" ADD COLUMN IF NOT EXISTS "attempt" integer NOT NULL DEFAULT 0;
ALTER TABLE "ops"."jobs" ADD COLUMN IF NOT EXISTS "result" jsonb;
ALTER TABLE "ops"."jobs" ADD COLUMN IF NOT EXISTS "last_error_detail" text;
ALTER TABLE "ops"."jobs" ADD COLUMN IF NOT EXISTS "run_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "ops"."jobs" DROP CONSTRAINT IF EXISTS "ops_jobs_attempt_nonnegative";
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "ops_jobs_attempt_nonnegative" CHECK ("attempt" >= 0);
ALTER TABLE "ops"."jobs" DROP CONSTRAINT IF EXISTS "ops_jobs_run_count_nonnegative";
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "ops_jobs_run_count_nonnegative" CHECK ("run_count" >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS "ops_jobs_job_key_unique"
  ON "ops"."jobs" ("job_key") WHERE "job_key" IS NOT NULL;
