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

export const badgeAwards = clubSchema.table("badge_awards", {
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  badgeKey: text("badge_key").notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.badgeKey] })]);
