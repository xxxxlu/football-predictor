import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { identityUsers } from "../identity/schema.js";

export const billingSchema = pgSchema("billing");

export const subscriptions = billingSchema.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => identityUsers.id, { onDelete: "cascade" }),
    planTier: text("plan_tier").notNull(),
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    provider: text("provider").notNull().default("stripe"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_subscriptions_active_user_unique")
      .on(table.userId)
      .where(sql`${table.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`),
    index("billing_subscriptions_user_idx").on(table.userId),
    index("billing_subscriptions_provider_sub_idx").on(table.providerSubscriptionId),
  ],
);

export const checkoutSessions = billingSchema.table("checkout_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => identityUsers.id, { onDelete: "cascade" }),
  planTier: text("plan_tier").notNull(),
  provider: text("provider").notNull(),
  sessionId: text("session_id").notNull().unique(),
  status: text("status").notNull().default("PENDING"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const webhookEvents = billingSchema.table("webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
