import { boolean, date, index, integer, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { identityUsers } from "../identity/schema.js";

/**
 * Club daily engagement (Story 12.2, docs/adr/0001-club-schema.md). Every FK
 * targets identity.users and nothing else: no room/prediction/ledger reference
 * columns, no numeric point amounts — XP is an integer engagement counter.
 */
export const clubSchema = pgSchema("club");

export const dailyChallengeAttempts = clubSchema.table("daily_challenge_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  productDay: date("product_day").notNull(),
  questionKey: text("question_key").notNull(),
  bankVersion: integer("bank_version").notNull(),
  xpRulesVersion: integer("xp_rules_version").notNull(),
  answer: text("answer").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  xpAwarded: integer("xp_awarded").notNull(),
  streakAfter: integer("streak_after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("daily_challenge_attempts_one_per_day").on(table.userId, table.productDay),
  index("daily_challenge_attempts_day_idx").on(table.productDay),
]);

export const engagementProfiles = clubSchema.table("engagement_profiles", {
  userId: uuid("user_id").primaryKey().references(() => identityUsers.id, { onDelete: "cascade" }),
  xpTotal: integer("xp_total").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  lastAnsweredDay: date("last_answered_day"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The one public channel (Story 12.4). Immutable rows — no edit/delete columns;
 * visibility lives in channel_message_moderation. report_id columns below are
 * plain uuids on purpose: the governance queue sits in the room schema and AC1
 * forbids any club→room foreign key.
 */
export const channelMessages = clubSchema.table("channel_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("club_channel_messages_keyset_idx").on(table.createdAt, table.id)]);

export const channelMessageModeration = clubSchema.table("channel_message_moderation", {
  messageId: uuid("message_id").primaryKey().references(() => channelMessages.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  reportId: uuid("report_id"),
  reason: text("reason").notNull(),
  hiddenBy: uuid("hidden_by").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }).notNull(),
  restoredBy: uuid("restored_by").references(() => identityUsers.id, { onDelete: "restrict" }),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
});

/** Community-level mutes: one shared channel, so the live-mute key is the user alone. */
export const channelMutes = clubSchema.table("channel_mutes", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  reportId: uuid("report_id"),
  reason: text("reason").notNull(),
  mutedBy: uuid("muted_by").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  mutedAt: timestamp("muted_at", { withTimezone: true }).notNull(),
  mutedUntil: timestamp("muted_until", { withTimezone: true }).notNull(),
  liftedBy: uuid("lifted_by").references(() => identityUsers.id, { onDelete: "restrict" }),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
}, (table) => [index("club_channel_mutes_user_idx").on(table.userId, table.mutedUntil)]);

export const badgeAwards = clubSchema.table("badge_awards", {
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  badgeKey: text("badge_key").notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.badgeKey] })]);
