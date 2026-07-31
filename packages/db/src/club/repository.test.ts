import { questionForProductDay } from "@pulse/domain";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { OperationError } from "../operations/repository.js";
import { createClubRepository } from "./repository.js";

type Row = Record<string, unknown>;
type Respond = (query: string, values: unknown[]) => Row[];

/** Same fake as identity/social.test.ts: thenable queries + begin passthrough. */
class FakeQuery {
  constructor(readonly strings: readonly string[], readonly values: readonly unknown[], private readonly run: (query: FakeQuery) => Promise<Row[]>) {}
  then<T, U>(resolve?: (rows: Row[]) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) {
    return this.run(this).then(resolve, reject);
  }
}

function flatten(query: FakeQuery): { text: string; values: unknown[] } {
  let text = "";
  const values: unknown[] = [];
  query.strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= query.values.length) return;
    const value = query.values[index];
    if (value instanceof FakeQuery) { const inner = flatten(value); text += inner.text; values.push(...inner.values); }
    else { text += " $ "; values.push(value); }
  });
  return { text, values };
}

function fakeSql(respond: Respond, log?: { queries: string[]; values: unknown[] }) {
  const run = async (query: FakeQuery) => {
    const { text, values } = flatten(query);
    const normalized = text.replace(/\s+/g, " ").trim();
    log?.queries.push(normalized);
    log?.values.push(...values);
    return respond(normalized, values);
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => new FakeQuery(strings, values, run);
  (sql as unknown as { begin: unknown }).begin = (handler: (tx: unknown) => Promise<unknown>) => handler(sql);
  return sql as unknown as postgres.Sql;
}

const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const DAY = "2026-07-31";
const QUESTION = questionForProductDay(DAY);
const WRONG = QUESTION.correctOption === "A" ? "B" : "A";

const attemptRow = (overrides: Row = {}): Row => ({
  productDay: DAY, questionKey: QUESTION.key, answer: QUESTION.correctOption,
  isCorrect: true, xpAwarded: 11, streakAfter: 1, ...overrides,
});

describe("submitAttempt", () => {
  it("replays an existing attempt without writing or awarding anything", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubRepository(
      fakeSql((query) => {
        if (query.includes("FROM club.daily_challenge_attempts WHERE user_id = $ AND product_day = $")) return [attemptRow()];
        if (query.includes("FROM club.engagement_profiles WHERE user_id = $ LIMIT 1")) return [{ xpTotal: 11, currentStreak: 1, bestStreak: 1, lastAnsweredDay: DAY }];
        return [];
      }, log),
    );
    const result = await repository.submitAttempt(USER, DAY, QUESTION.correctOption);
    expect(result.replayed).toBe(true);
    expect(result.newBadges).toEqual([]);
    expect(log.queries.some((query) => query.includes("INSERT INTO"))).toBe(false);
  });

  it("scores server-side, persists versions, updates the profile and grants first badges in one transaction", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubRepository(
      fakeSql((query) => {
        if (query.includes("INSERT INTO club.daily_challenge_attempts")) return [attemptRow()];
        if (query.includes("INSERT INTO club.engagement_profiles")) return [{ xpTotal: 11, currentStreak: 1, bestStreak: 1, lastAnsweredDay: DAY }];
        if (query.includes("INSERT INTO club.badge_awards")) return [{ badgeKey: "FIRST_ANSWER" }];
        return [];
      }, log),
    );
    const result = await repository.submitAttempt(USER, DAY, QUESTION.correctOption);
    expect(result.replayed).toBe(false);
    expect(result.newBadges).toEqual(["FIRST_ANSWER"]);
    const insert = log.queries.find((query) => query.includes("INSERT INTO club.daily_challenge_attempts"));
    expect(insert).toBeDefined();
    // The recorded row carries the question key and both rule versions for audit.
    expect(log.values).toContain(QUESTION.key);
    expect(log.queries.some((query) => query.includes("GREATEST(club.engagement_profiles.best_streak"))).toBe(true);
    expect(log.queries.some((query) => query.includes("ON CONFLICT (user_id, badge_key) DO NOTHING"))).toBe(true);
  });

  it("retries the whole transaction once when a concurrent submit wins the unique race", async () => {
    let inserts = 0;
    const repository = createClubRepository(
      fakeSql((query) => {
        if (query.includes("FROM club.daily_challenge_attempts WHERE user_id = $ AND product_day = $")) {
          // First pass sees nothing; the retry sees the winner's row.
          return inserts > 0 ? [attemptRow({ answer: WRONG, isCorrect: false, xpAwarded: 0, streakAfter: 0 })] : [];
        }
        if (query.includes("FROM club.engagement_profiles WHERE user_id = $ LIMIT 1")) return [{ xpTotal: 0, currentStreak: 0, bestStreak: 0, lastAnsweredDay: DAY }];
        if (query.includes("INSERT INTO club.daily_challenge_attempts")) {
          inserts += 1;
          const duplicate = new Error("duplicate key value violates unique constraint \"daily_challenge_attempts_one_per_day\"");
          (duplicate as { code?: string }).code = "23505";
          throw duplicate;
        }
        return [];
      }),
    );
    const result = await repository.submitAttempt(USER, DAY, QUESTION.correctOption);
    // The loser converges on the winner's recorded attempt — no second award.
    expect(result.replayed).toBe(true);
    expect(result.attempt.answer).toBe(WRONG);
    expect(inserts).toBe(1);
  });
});

describe("result reads", () => {
  const clean = [{ pulseId: "bob", nickname: null, answered: true, correct: false, streak: 0 }];

  it("passes clean rows through the projection guard and rejects drift", async () => {
    const repository = createClubRepository(fakeSql(() => clean));
    await expect(repository.listFriendResults(USER, DAY)).resolves.toEqual(clean);
    const drifted = createClubRepository(fakeSql(() => [{ ...clean[0], balance: 100 }]));
    await expect(drifted.listFriendResults(USER, DAY)).rejects.toThrow(/must never carry "balance"/);
  });

  it("reuses the 12.1 friendship + block shape in the friends SQL", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubRepository(fakeSql(() => [], log));
    await repository.listFriendResults(USER, DAY);
    const [query] = log.queries;
    expect(query).toContain("f.status = 'ACCEPTED'");
    expect(query).toContain("identity.user_blocks");
    expect(query).toContain("u.status = 'ACTIVE'");
    // No points/ledger/prediction relation may appear in a club read.
    expect(query).not.toMatch(/ledger\.|prediction\.|room\./);
  });

  it("authorizes room membership before reading any member results", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const denied = createClubRepository(fakeSql(() => [], log));
    const failure = await denied.listRoomResults(USER, "room-1", DAY).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OperationError);
    expect((failure as OperationError).code).toBe("ROOM_NOT_FOUND");
    // Only the membership probe ran — the roster query never fired.
    expect(log.queries).toHaveLength(1);
    expect(log.queries[0]).toContain("FROM room.members");
  });

  it("reads room results from roster + club tables without joining prediction or ledger", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = createClubRepository(
      fakeSql((query) => (query.includes("SELECT role FROM room.members") ? [{ role: "MEMBER" }] : clean), log),
    );
    await expect(repository.listRoomResults(USER, "room-1", DAY)).resolves.toEqual(clean);
    const roster = log.queries[1];
    expect(roster).toContain("FROM room.members m");
    expect(roster).not.toMatch(/ledger\.|prediction\./);
  });
});

describe("getDailyState", () => {
  it("returns an empty profile and no attempt for a first-time user", async () => {
    const repository = createClubRepository(fakeSql(() => []));
    const state = await repository.getDailyState(USER, DAY);
    expect(state.attempt).toBeNull();
    expect(state.profile).toEqual({ xpTotal: 0, currentStreak: 0, bestStreak: 0, lastAnsweredDay: null });
    expect(state.badges).toEqual([]);
  });
});
