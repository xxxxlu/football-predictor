import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { OperationError, PostgresOperationsRepository, projectCrossCompetitionHistory, type CrossCompetitionHistoryRow } from "./repository.js";

const row = (overrides: Partial<CrossCompetitionHistoryRow> = {}): CrossCompetitionHistoryRow => ({
  ticketId: "ticket-1",
  roomId: "room-1",
  roomName: "老友局",
  fixtureId: "fixture-1",
  competitionId: "39",
  competitionName: "Premier League",
  season: 2026,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  kickoffAt: "2026-08-15T12:00:00.000Z",
  selection: "HOME",
  stakePoints: "1000.00",
  outcome: "WIN",
  grossReturnPoints: "2100.00",
  settlementVersion: "result-v2",
  settledAt: "2026-08-15T15:00:00.000Z",
  ledgerId: "ledger-1",
  auditId: "audit-1",
  ...overrides,
});

describe("cross-competition history projection", () => {
  it("groups the current user's active settlements by competition and season", () => {
    const archive = projectCrossCompetitionHistory([
      row(),
      row({ ticketId: "ticket-2", roomId: "room-2", roomName: "办公室", outcome: "LOSS", grossReturnPoints: "0.00", ledgerId: "ledger-2", auditId: "audit-2" }),
      row({ ticketId: "ticket-3", fixtureId: "fixture-3", competitionId: "2", competitionName: "UEFA Champions League", season: 2026, outcome: "PUSH", grossReturnPoints: "1000.00", ledgerId: "ledger-3", auditId: "audit-3" }),
    ]);

    expect(archive.scope).toEqual({ performance: "USER_CROSS_COMPETITION", balances: "PER_ROOM" });
    expect(archive.summary).toEqual({ settledTickets: 3, wins: 1, losses: 1, voids: 1 });
    expect(archive.competitions).toEqual([
      { competitionId: "39", competitionName: "Premier League", season: 2026, settledTickets: 2, wins: 1, losses: 1, voids: 0 },
      { competitionId: "2", competitionName: "UEFA Champions League", season: 2026, settledTickets: 1, wins: 0, losses: 0, voids: 1 },
    ]);
  });

  it("keeps room identity and versioned ledger evidence on every record without merging balances", () => {
    const archive = projectCrossCompetitionHistory([row()]);

    expect(archive.records[0]).toMatchObject({
      ticketId: "ticket-1",
      room: { id: "room-1", name: "老友局" },
      settlement: { outcome: "WIN", version: "result-v2", ledgerId: "ledger-1", auditId: "audit-1" },
    });
    expect(archive.records[0]).not.toHaveProperty("balance");
    expect(archive.summary).not.toHaveProperty("points");
  });
});

// drizzle(client) 会把共享 postgres.js 客户端的 date 序列化器改写成透传，Date 实例参数
// 会原样进 Buffer.byteLength 抛 TypeError——web 运行时的真实约束，假 sql 同样拒绝 Date。
function fakeSql(respond: (query: string) => Array<Record<string, unknown>>, seen?: unknown[]) {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    for (const value of values) {
      seen?.push(value);
      if (value instanceof Date) throw new TypeError('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date');
    }
    return Promise.resolve(respond(strings.join(" ")));
  };
  return sql as unknown as postgres.Sql;
}

describe("admin status aggregation", () => {
  const clock = { now: () => new Date("2026-07-16T10:00:00.000Z") };
  // adminStatus resolves the caller's operator duties first; a super-admin holds
  // every capability, so the aggregation queries run behind it.
  const asAdmin = (respond: (query: string) => Array<Record<string, unknown>>) => (query: string) =>
    query.includes("identity.operator_role_grants") ? [{ isSuperAdmin: true, roles: null }] : respond(query);

  it("returns zeroed sections instead of failing when budget/cache/settlement/jobs are empty", async () => {
    const repository = new PostgresOperationsRepository(fakeSql(asAdmin(() => [])), clock);
    const status = await repository.adminStatus("admin-1");
    expect(status.supplierBudget).toEqual({ utcDate: "2026-07-16", limit: 95, generalUsed: 0, settlementUsed: 0, settlementReserved: 10 });
    expect(status.cache).toEqual({ freshMatches: 0, staleMatches: 0, unavailableMatches: 0, oldestDataAsOf: null });
    expect(status.settlement).toEqual({ pending: 0, failed: 0, oldestPendingAt: null, lastSuccessAt: null });
    expect(status.jobs).toEqual({ queued: 0, running: 0, failed: 0, maxLagSeconds: 0 });
    expect(status.overall).toBe("HEALTHY");
  });

  it("never passes Date instances as SQL parameters", async () => {
    const seen: unknown[] = [];
    const repository = new PostgresOperationsRepository(fakeSql(asAdmin(() => []), seen), clock);
    await repository.adminStatus("admin-1");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((value) => value instanceof Date)).toBe(false);
  });

  it("reports real degradation instead of faking health", async () => {
    const degraded = new PostgresOperationsRepository(fakeSql(asAdmin((query) =>
      query.includes("supplier.markets") ? [{ freshMatches: 0, staleMatches: 3, unavailableMatches: 0, oldestDataAsOf: "2026-07-14 09:26:01.806+00" }] : [])), clock);
    const degradedStatus = await degraded.adminStatus("admin-1");
    expect(degradedStatus.overall).toBe("DEGRADED");
    expect(degradedStatus.cache.staleMatches).toBe(3);
    expect(degradedStatus.cache.oldestDataAsOf).toBe("2026-07-14T09:26:01.806Z");

    const critical = new PostgresOperationsRepository(fakeSql(asAdmin((query) =>
      query.includes("ops.jobs") ? [{ queued: 1, running: 0, failed: 2, maxLagSeconds: 40 }] : [])), clock);
    expect((await critical.adminStatus("admin-1")).overall).toBe("CRITICAL");
  });

  it("rejects viewers without the operational-health capability before any aggregation", async () => {
    // A plain user, a community moderator (whose duty does not cover operational
    // health) and an unknown/disabled account are all refused.
    const authorizations: Array<Array<Record<string, unknown>>> = [
      [{ isSuperAdmin: false, roles: null }],
      [{ isSuperAdmin: false, roles: ["COMMUNITY_MODERATOR"] }],
      [],
    ];
    for (const authorization of authorizations) {
      const seen: unknown[] = [];
      const repository = new PostgresOperationsRepository(fakeSql((query) =>
        query.includes("identity.operator_role_grants") ? authorization : [{ unexpected: true }], seen), clock);
      const failure = await repository.adminStatus("user-1").catch((error: OperationError) => error);
      expect(failure).toBeInstanceOf(OperationError);
      expect((failure as OperationError).status).toBe(403);
      expect(seen).toEqual(["user-1"]);
    }
  });

  it("lets an operations-admin read operational health without super-admin rights", async () => {
    const repository = new PostgresOperationsRepository(fakeSql((query) =>
      query.includes("identity.operator_role_grants") ? [{ isSuperAdmin: false, roles: ["OPERATIONS_ADMIN"] }] : []), clock);
    await expect(repository.adminStatus("ops-1")).resolves.toMatchObject({ overall: "HEALTHY" });
  });
});

describe("nickname update", () => {
  it("never passes Date instances as SQL parameters", async () => {
    const seen: unknown[] = [];
    const repository = new PostgresOperationsRepository(fakeSql((query) =>
      query.includes("UPDATE identity.users") ? [{ id: "user-1" }]
        : query.includes("SELECT id,username_canonical") ? [{ id: "user-1", username: "alice", nickname: "Alice", superAdmin: false }] : [], seen), { now: () => new Date("2026-07-16T10:00:00.000Z") });
    const profile = await repository.updateNickname("user-1", "Alice");
    expect(profile).toMatchObject({ id: "user-1", nickname: "Alice" });
    expect(seen.some((value) => value instanceof Date)).toBe(false);
  });
});
