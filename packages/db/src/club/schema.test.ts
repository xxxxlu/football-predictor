import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { badgeAwards, dailyChallengeAttempts, engagementProfiles } from "./schema.js";

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
