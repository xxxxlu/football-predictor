-- 0033_pro_subscriptions.sql
-- PULSE PRO VIP membership and checkout billing foundations.
--
-- Provides:
-- 1. billing schema for subscription lifecycle management.
-- 2. billing.subscriptions: Tracks user tier (FREE, PRO_TRIAL, PRO_MONTHLY, PRO_ANNUAL) and status.
-- 3. billing.checkout_sessions: Tracks payment checkout sessions.
-- 4. billing.webhook_events: Idempotent audit record for payment provider webhooks (Stripe / etc.).

CREATE SCHEMA IF NOT EXISTS "billing";

CREATE TABLE IF NOT EXISTS "billing"."subscriptions" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "plan_tier" text NOT NULL,
  "status" text NOT NULL,
  "current_period_start" timestamp with time zone NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "canceled_at" timestamp with time zone,
  "trial_start" timestamp with time zone,
  "trial_end" timestamp with time zone,
  "provider" text NOT NULL DEFAULT 'stripe',
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "billing_subscriptions_plan_tier_check" CHECK ("plan_tier" IN ('FREE', 'PRO_TRIAL', 'PRO_MONTHLY', 'PRO_ANNUAL')),
  CONSTRAINT "billing_subscriptions_status_check" CHECK ("status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  CONSTRAINT "billing_subscriptions_provider_check" CHECK ("provider" IN ('stripe', 'alipay', 'wechat', 'mock_gateway'))
);

-- Guarantee at most one non-terminal subscription per user at any time.
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_active_user_unique"
  ON "billing"."subscriptions" ("user_id") WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

-- Lookup index by user_id for fast profile fetches
CREATE INDEX IF NOT EXISTS "billing_subscriptions_user_idx"
  ON "billing"."subscriptions" ("user_id");

-- Lookup index by external provider subscription ID for Webhook syncing
CREATE INDEX IF NOT EXISTS "billing_subscriptions_provider_sub_idx"
  ON "billing"."subscriptions" ("provider_subscription_id") WHERE "provider_subscription_id" IS NOT NULL;

-- Checkout sessions
CREATE TABLE IF NOT EXISTS "billing"."checkout_sessions" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "plan_tier" text NOT NULL,
  "provider" text NOT NULL,
  "session_id" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'PENDING',
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'usd',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  CONSTRAINT "billing_checkout_plan_tier_check" CHECK ("plan_tier" IN ('PRO_MONTHLY', 'PRO_ANNUAL')),
  CONSTRAINT "billing_checkout_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED', 'EXPIRED')),
  CONSTRAINT "billing_checkout_provider_check" CHECK ("provider" IN ('stripe', 'alipay', 'wechat', 'mock_gateway'))
);

-- Idempotency ledger for webhook events
CREATE TABLE IF NOT EXISTS "billing"."webhook_events" (
  "id" text PRIMARY KEY,
  "provider" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now()
);
