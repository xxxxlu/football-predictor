import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { capabilitiesFor, decodeKeysetCursor, type OperatorRole } from "@pulse/domain";
import { LEADERBOARD_MAX_ROWS, LEDGER_CURSOR_START, LEDGER_PAGE_SIZE, OperationError, PostgresOperationsRepository, projectCrossCompetitionHistory, type CrossCompetitionHistoryRow } from "./repository.js";

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
  // The aggregate is handed the caller's already-resolved authorization: its one
  // caller, the overview, reads it to decide which cards exist and would
  // otherwise make the identical read twice. The capability is still asserted.
  const asRoles = (...roles: OperatorRole[]) => ({ isSuperAdmin: roles.includes("SUPER_ADMIN"), roles, capabilities: [...capabilitiesFor(roles)] });
  const ADMIN = asRoles("SUPER_ADMIN");

  it("returns zeroed sections instead of failing when budget/cache/settlement/jobs are empty", async () => {
    const repository = new PostgresOperationsRepository(fakeSql(() => []), clock);
    const status = await repository.adminStatus(ADMIN);
    expect(status.supplierBudget).toEqual({ utcDate: "2026-07-16", limit: 95, generalUsed: 0, settlementUsed: 0, settlementReserved: 10 });
    expect(status.cache).toEqual({ freshMatches: 0, staleMatches: 0, unavailableMatches: 0, oldestDataAsOf: null });
    expect(status.settlement).toEqual({ pending: 0, failed: 0, oldestPendingAt: null, lastSuccessAt: null });
    expect(status.jobs).toEqual({ queued: 0, running: 0, failed: 0, maxLagSeconds: 0 });
    expect(status.overall).toBe("HEALTHY");
  });

  it("never passes Date instances as SQL parameters", async () => {
    const seen: unknown[] = [];
    const repository = new PostgresOperationsRepository(fakeSql(() => [], seen), clock);
    await repository.adminStatus(ADMIN);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((value) => value instanceof Date)).toBe(false);
  });

  it("reports real degradation instead of faking health", async () => {
    const degraded = new PostgresOperationsRepository(fakeSql((query) =>
      query.includes("supplier.markets") ? [{ freshMatches: 0, staleMatches: 3, unavailableMatches: 0, oldestDataAsOf: "2026-07-14 09:26:01.806+00" }] : []), clock);
    const degradedStatus = await degraded.adminStatus(ADMIN);
    expect(degradedStatus.overall).toBe("DEGRADED");
    expect(degradedStatus.cache.staleMatches).toBe(3);
    expect(degradedStatus.cache.oldestDataAsOf).toBe("2026-07-14T09:26:01.806Z");

    const critical = new PostgresOperationsRepository(fakeSql((query) =>
      query.includes("ops.jobs") ? [{ queued: 1, running: 0, failed: 2, maxLagSeconds: 40 }] : []), clock);
    expect((await critical.adminStatus(ADMIN)).overall).toBe("CRITICAL");
  });

  it("rejects viewers without the operational-health capability before any aggregation", async () => {
    // A plain user and a community moderator (whose duty does not cover
    // operational health) are both refused — and refused before a single
    // aggregation query is issued, so a caller that resolved *some* duty cannot
    // read health it has no claim to.
    for (const authorization of [asRoles(), asRoles("COMMUNITY_MODERATOR")]) {
      const seen: unknown[] = [];
      const repository = new PostgresOperationsRepository(fakeSql(() => [{ unexpected: true }], seen), clock);
      const failure = await repository.adminStatus(authorization).catch((error: OperationError) => error);
      expect(failure).toBeInstanceOf(OperationError);
      expect((failure as OperationError).status).toBe(403);
      expect(seen).toEqual([]);
    }
  });

  it("lets an operations-admin read operational health without super-admin rights", async () => {
    const repository = new PostgresOperationsRepository(fakeSql(() => []), clock);
    await expect(repository.adminStatus(asRoles("OPERATIONS_ADMIN"))).resolves.toMatchObject({ overall: "HEALTHY" });
  });

  it("reads no operator row of its own — the caller already resolved one", async () => {
    const seen: string[] = [];
    const repository = new PostgresOperationsRepository(fakeSql((query) => { seen.push(query); return []; }), clock);
    await repository.adminStatus(ADMIN);
    expect(seen.some((query) => query.includes("identity.operator_role_grants"))).toBe(false);
  });
});

describe("nickname update", () => {
  it("never passes Date instances as SQL parameters", async () => {
    const seen: unknown[] = [];
    const repository = new PostgresOperationsRepository(fakeSql((query) =>
      query.includes("UPDATE identity.users") ? [{ id: "user-1" }]
        // Story 12.6 aliased the profile read to `u` and joined the avatar, so
        // the projection can hand the account page its own photo.
        : query.includes("SELECT u.id,u.username_canonical") ? [{ id: "user-1", username: "alice", nickname: "Alice", superAdmin: false, avatarPublicId: null, avatarVersion: null }] : [], seen), { now: () => new Date("2026-07-16T10:00:00.000Z") });
    const profile = await repository.updateNickname("user-1", "Alice");
    expect(profile).toMatchObject({ id: "user-1", nickname: "Alice", avatarUrl: null, avatarVersion: null });
    expect(seen.some((value) => value instanceof Date)).toBe(false);
  });

  it("returns the member's own avatar with the profile, so the pass never renders empty first", async () => {
    const repository = new PostgresOperationsRepository(fakeSql((query) =>
      query.includes("SELECT u.id,u.username_canonical")
        ? [{ id: "user-1", username: "alice", nickname: "Alice", superAdmin: false, avatarPublicId: "7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607", avatarVersion: 3 }]
        : []), { now: () => new Date("2026-07-16T10:00:00.000Z") });
    await expect(repository.getProfile("user-1")).resolves.toMatchObject({
      avatarUrl: "/api/v1/media/avatars/7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607/3.webp",
      avatarVersion: 3,
    });
  });
});

// The ledger is the member-facing explanation of where their points went, and
// it used to be capped at 200 rows with `nextCursor` pinned to null — the rest
// of an account's history was unreachable in the product. The running balance
// also came from a window over the whole account, evaluated before LIMIT, so
// every open re-scanned every entry ever written.
describe("ledger paging", () => {
  const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const entry = (index: number) => ({
    id: uuid(index), roomId: "room-1", kind: "INITIAL_GRANT", outcome: null,
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    availableDelta: "10.00", frozenDelta: "0.00", debtDelta: "0.00",
    availableAfter: "10.00", frozenAfter: "0.00", debtAfter: "0.00",
    ticketId: null, settlementVersion: null, auditId: uuid(index), reversesLedgerId: null, hasPriorSettlement: false,
  });

  // Newest first, exactly as the real ORDER BY returns them.
  const page = (count: number) => Array.from({ length: count }, (_, index) => entry(count - index));

  function harness(input: { rows?: number; account?: boolean } = {}) {
    const queries: string[] = [];
    const seen: unknown[] = [];
    const sql = fakeSql((query) => {
      queries.push(query);
      if (query.includes("room.members")) return [{ role: "MEMBER", preMatchStakeVisible: true, postMatchTicketVisible: true }];
      if (query.includes('available_points::text AS available')) return (input.account ?? true) ? [{ available: "9000.00", frozen: "1000.00", debt: "0.00" }] : [];
      if (query.includes("COALESCE(SUM(available_delta_points)")) return [{ available: "500.00", frozen: "0.00", debt: "0.00" }];
      if (query.includes("WITH page AS")) return page(input.rows ?? 3);
      return [];
    }, seen);
    return { repository: new PostgresOperationsRepository(sql), queries, seen };
  }

  const pageQuery = (queries: string[]) => queries.find((query) => query.includes("WITH page AS")) ?? "";

  it("confines the running-balance window to the page instead of the whole account", async () => {
    const { repository, queries } = harness();
    await repository.ledger("room-1", "user-1");
    const query = pageQuery(queries);
    expect(query).toContain("WITH page AS");
    // The frame is bounded to the rows above each row *within the CTE*, which is
    // what makes the read cost the page rather than the account's whole history.
    expect(query).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
    expect(query).toContain("FROM page p");
    // The old unbounded prefix sum over ledger.entries must not come back.
    expect(query).not.toMatch(/OVER\s*\(ORDER BY e\.created_at/);
  });

  it("anchors page one on the account row without an aggregate over rows nobody has seen", async () => {
    const { repository, queries } = harness();
    await repository.ledger("room-1", "user-1");
    expect(queries.some((query) => query.includes("FROM ledger.point_accounts WHERE room_id="))).toBe(true);
    expect(queries.some((query) => query.includes("COALESCE(SUM(available_delta_points)"))).toBe(false);
  });

  it("serves both pages from one statement by comparing against a start sentinel", async () => {
    const { repository, seen } = harness();
    await repository.ledger("room-1", "user-1");
    // A `cursor IS NULL OR ...` disjunction would have cost the index range scan.
    expect(seen).toContain(LEDGER_CURSOR_START.createdAt);
    expect(seen).toContain(LEDGER_CURSOR_START.id);
  });

  it("uses a sentinel postgres.js can actually bind as a timestamptz", () => {
    // Not a style point: postgres.js serializes every timestamptz parameter
    // through `new Date(x).toISOString()` (postgres/src/types.js), so Postgres's
    // own `'infinity'` input is unbindable — it becomes an Invalid Date and
    // throws in the driver before a packet is sent. Verified against a real
    // server; no amount of query-text assertion would have caught it.
    expect(new Date(LEDGER_CURSOR_START.createdAt).toISOString()).toBe(LEDGER_CURSOR_START.createdAt);
  });

  it("reports no next page when the page is not full", async () => {
    const { repository } = harness({ rows: 5 });
    await expect(repository.ledger("room-1", "user-1")).resolves.toMatchObject({ nextCursor: null });
  });

  it("hands back a cursor addressing the last entry it actually returned", async () => {
    const { repository } = harness({ rows: LEDGER_PAGE_SIZE + 1 });
    const result = await repository.ledger("room-1", "user-1");
    expect(result.entries).toHaveLength(LEDGER_PAGE_SIZE);
    const last = result.entries[LEDGER_PAGE_SIZE - 1];
    expect(decodeKeysetCursor(result.nextCursor ?? "")).toEqual({ createdAt: last?.createdAt, id: last?.id });
  });

  it("never shows the probe row it used to detect the next page", async () => {
    // Fetching PAGE_SIZE + 1 is how "is there more?" is answered without a
    // count(*); leaking that extra row would silently widen every page by one.
    const { repository } = harness({ rows: LEDGER_PAGE_SIZE + 1 });
    const result = await repository.ledger("room-1", "user-1");
    const overflow = page(LEDGER_PAGE_SIZE + 1)[LEDGER_PAGE_SIZE];
    expect(result.entries.map((row) => row.id)).not.toContain(overflow?.id);
  });

  it("backs the anchor out over the rows already shown when a cursor is supplied", async () => {
    const cursor = { createdAt: "2026-07-01T00:10:00.000Z", id: uuid(10) };
    const { repository, queries, seen } = harness();
    await repository.ledger("room-1", "user-1", { cursor });

    // The opening balance is recomputed server-side from the account minus the
    // entries at or above the cursor — never trusted from the cursor itself.
    expect(queries.some((query) => query.includes("COALESCE(SUM(available_delta_points)"))).toBe(true);
    expect(seen).toContain(cursor.createdAt);
    expect(seen).toContain(cursor.id);
    expect(seen).not.toContain("9999-12-31T23:59:59.999Z");
  });

  it("returns an empty page rather than inventing balances when the account row is missing", async () => {
    const { repository, queries } = harness({ account: false });
    await expect(repository.ledger("room-1", "user-1")).resolves.toEqual({ entries: [], nextCursor: null });
    expect(pageQuery(queries)).toBe("");
  });
});

describe("room leaderboard", () => {
  function harness() {
    const queries: string[] = [];
    const seen: unknown[] = [];
    const sql = fakeSql((query) => {
      queries.push(query);
      if (query.includes("room.members")) return [{ role: "MEMBER", preMatchStakeVisible: true, postMatchTicketVisible: true }];
      if (query.includes("identity.users u")) return [{ userId: "user-1", displayName: "Alice", availablePoints: "10500.00", frozenPoints: "0.00", correctionDebt: "0.00", settledTickets: 4 }];
      return [];
    }, seen);
    return { repository: new PostgresOperationsRepository(sql), queries, seen };
  }
  const standingQuery = (queries: string[]) => queries.find((query) => query.includes("identity.users u")) ?? "";

  it("counts settled tickets with a subquery instead of a join it then groups away", async () => {
    const { repository, queries } = harness();
    await repository.leaderboard("room-1", "user-1");
    const query = standingQuery(queries);
    // Joining every ticket in the room multiplied the scanned rows by each
    // member's history, and the GROUP BY existed only to undo that.
    expect(query).not.toContain("LEFT JOIN prediction.tickets");
    expect(query).not.toContain("GROUP BY");
    expect(query).toContain("SELECT COUNT(*) FROM prediction.tickets t");
  });

  it("bounds the standing from the bottom of the ranking, not at an arbitrary row", async () => {
    const { repository, queries, seen } = harness();
    await repository.leaderboard("room-1", "user-1");
    expect(standingQuery(queries)).toContain("ORDER BY (a.available_points - a.correction_debt) DESC");
    expect(seen).toContain(LEADERBOARD_MAX_ROWS);
  });

  it("still ranks by net points after the room's own scoring offset", async () => {
    const { repository } = harness();
    await expect(repository.leaderboard("room-1", "user-1")).resolves.toEqual([
      expect.objectContaining({ rank: 1, userId: "user-1", netPoints: "500.00", settledTickets: 4 }),
    ]);
  });
});
