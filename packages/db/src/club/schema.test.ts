import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { badgeAwards, channelMessageModeration, channelMessages, channelMutes, dailyChallengeAttempts, engagementProfiles } from "./schema.js";

describe("club database schema", () => {
  it("keeps one official attempt per user per product day with auditable versions", () => {
    const attempts = getTableConfig(dailyChallengeAttempts);
    expect(attempts.schema).toBe("club");
    expect(attempts.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_id", "product_day", "question_key", "bank_version", "xp_rules_version", "answer", "is_correct", "xp_awarded", "streak_after"]),
    );
    expect(attempts.uniqueConstraints.some((constraint) => constraint.name === "daily_challenge_attempts_one_per_day")).toBe(true);
  });

  it("tracks engagement as integers and badges as a closed keyed set", () => {
    const profiles = getTableConfig(engagementProfiles);
    expect(profiles.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_id", "xp_total", "current_streak", "best_streak", "last_answered_day"]),
    );
    const badges = getTableConfig(badgeAwards);
    expect(badges.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["user_id", "badge_key", "awarded_at"]));
  });

  it("models the channel as immutable messages with moderation state and community mutes on top", () => {
    const messages = getTableConfig(channelMessages);
    expect(messages.schema).toBe("club");
    expect(messages.columns.map((column) => column.name)).toEqual(["id", "user_id", "body", "created_at"]);

    const moderation = getTableConfig(channelMessageModeration);
    expect(moderation.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["message_id", "state", "report_id", "reason", "hidden_by", "hidden_at", "restored_by", "restored_at"]),
    );
    const mutes = getTableConfig(channelMutes);
    expect(mutes.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["id", "user_id", "report_id", "reason", "muted_by", "muted_at", "muted_until", "lifted_by", "lifted_at"]),
    );
    // No room column anywhere: a community mute silences the one shared channel.
    expect(mutes.columns.some((column) => column.name.includes("room"))).toBe(false);
  });

  it("keeps migration 0026 idempotent, isolated, and widens reports without touching the 0025 FK", async () => {
    const migration = await readFile(new URL("../../migrations/0026_club_lobby.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "club"."channel_messages"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "club"."channel_message_moderation"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "club"."channel_mutes"');
    // Immutability: body length is CHECK-guarded in code points; no edit/delete columns.
    expect(migration).toContain('CHECK (char_length("body") BETWEEN 1 AND 500)');
    expect(migration).not.toMatch(/edited_at|deleted_at/);
    // One live community mute per member, keyed on the user alone.
    expect(migration).toContain('ON "club"."channel_mutes" ("user_id") WHERE "lifted_at" IS NULL');
    // The third, independent directory opt-in, default OFF.
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "show_in_lobby_directory" boolean NOT NULL DEFAULT false');

    // The reports widening: nullable room, its own channel column with its own
    // FK, three-branch consistency, and the single-open-filing index.
    expect(migration).toContain('ALTER COLUMN "room_id" DROP NOT NULL');
    expect(migration).toContain('FOREIGN KEY ("channel_message_id") REFERENCES "club"."channel_messages"("id") ON DELETE RESTRICT');
    expect(migration).toContain("CHECK (\"kind\" IN ('ROOM','MESSAGE','CHANNEL_MESSAGE'))");
    expect(migration).toContain('"kind" = \'CHANNEL_MESSAGE\' AND "room_id" IS NULL AND "message_id" IS NULL AND "channel_message_id" IS NOT NULL');
    expect(migration).toContain('"channel_message_id", "reporter_user_id"');
    // 0025's message_id → room.messages FK is not touched.
    expect(migration).not.toContain('DROP CONSTRAINT IF EXISTS "reports_message_fk"');

    // AC1 isolation: inside the club schema, foreign keys may reach identity.users
    // and other club tables only — never room/prediction/ledger relations. The
    // reports widening lives on room.reports, which already sits in that schema.
    const clubTables = migration.slice(0, migration.indexOf('ALTER TABLE "room"."reports"'));
    const references = [...clubTables.replace(/--[^\n]*/g, "").matchAll(/REFERENCES\s+"([^"]+)"\."([^"]+)"/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(references.length).toBeGreaterThan(0);
    expect(new Set(references)).toEqual(new Set(["identity.users", "club.channel_messages"]));
    expect(clubTables.replace(/--[^\n]*/g, "")).not.toMatch(/"room"\.|"prediction"\.|"ledger"\.|"ops"\.|"f1"\./);
  });

  it("keeps migration 0024 idempotent and physically isolated from the points domains", async () => {
    const migration = await readFile(new URL("../../migrations/0024_club_daily.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "club"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "club"."daily_challenge_attempts"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "club"."engagement_profiles"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "club"."badge_awards"');
    // The one-per-day rule is arbitrated by the database.
    expect(migration).toContain('UNIQUE ("user_id", "product_day")');
    // Badge enum pinned by CHECK.
    expect(migration).toContain("CHECK (\"badge_key\" IN ('FIRST_ANSWER', 'STREAK_7', 'STREAK_30'))");

    const sqlOnly = migration.replace(/--[^\n]*/g, "");
    // AC4 three-fold isolation, first fold: only identity.users may be referenced.
    const references = [...sqlOnly.matchAll(/REFERENCES\s+"([^"]+)"\."([^"]+)"/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(references.length).toBeGreaterThan(0);
    expect(new Set(references)).toEqual(new Set(["identity.users"]));
    expect(sqlOnly).not.toMatch(/"room"\.|"prediction"\.|"ledger"\.|"product"\.|"ops"\.|"f1"\./);
    // XP is an integer engagement counter — the ledger money type must not appear.
    expect(sqlOnly).not.toMatch(/numeric/i);
    // Every counter is CHECK-guarded non-negative.
    for (const guarded of ["xp_awarded", "streak_after", "xp_total", "current_streak", "best_streak"]) {
      expect(sqlOnly).toContain(`CHECK ("${guarded}" >= 0)`);
    }
  });
});
