import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { checkoutSessions, subscriptions, webhookEvents } from "./schema.js";

describe("billing database schema and migration", () => {
  it("defines subscriptions table with strict tier and status lifecycle", () => {
    const config = getTableConfig(subscriptions);
    expect(config.schema).toBe("billing");
    expect(config.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "plan_tier",
        "status",
        "current_period_start",
        "current_period_end",
        "cancel_at_period_end",
        "canceled_at",
        "trial_start",
        "trial_end",
        "provider",
        "provider_customer_id",
        "provider_subscription_id",
        "created_at",
        "updated_at",
      ]),
    );

    // Concurrency guarantee: one active/trialing/past_due subscription per user
    const hasActiveUserIndex = config.indexes.some(
      (idx) => (idx.config?.name ?? (idx as any).name) === "billing_subscriptions_active_user_unique",
    );
    expect(hasActiveUserIndex).toBe(true);

  });

  it("defines checkout sessions and webhook event tables", () => {
    const checkoutConfig = getTableConfig(checkoutSessions);
    expect(checkoutConfig.schema).toBe("billing");
    expect(checkoutConfig.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "plan_tier",
        "provider",
        "session_id",
        "status",
        "amount_cents",
        "currency",
        "created_at",
      ]),
    );

    const webhookConfig = getTableConfig(webhookEvents);
    expect(webhookConfig.schema).toBe("billing");
    expect(webhookConfig.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "provider", "event_type", "payload", "processed_at"]),
    );
  });

  it("verifies migration 0033_pro_subscriptions.sql integrity, checks, and foreign keys", async () => {
    const migration = await readFile(
      new URL("../../migrations/0033_pro_subscriptions.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "billing"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "billing"."subscriptions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "billing"."checkout_sessions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "billing"."webhook_events"');

    // CHECK constraints
    expect(migration).toContain(
      "CHECK (\"plan_tier\" IN ('FREE', 'PRO_TRIAL', 'PRO_MONTHLY', 'PRO_ANNUAL'))",
    );
    expect(migration).toContain(
      "CHECK (\"status\" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'))",
    );
    expect(migration).toContain(
      "CHECK (\"provider\" IN ('stripe', 'alipay', 'wechat', 'mock_gateway'))",
    );

    // Isolation: Only identity.users may be referenced
    const sqlOnly = migration.replace(/--[^\n]*/g, "");
    const references = [
      ...sqlOnly.matchAll(/REFERENCES\s+"([^"]+)"\."([^"]+)"/g),
    ].map((m) => `${m[1]}.${m[2]}`);
    expect(references.length).toBeGreaterThan(0);
    expect(new Set(references)).toEqual(new Set(["identity.users"]));
  });
});
