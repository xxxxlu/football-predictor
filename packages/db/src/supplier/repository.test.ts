import { describe, expect, it } from "vitest";
import { cacheEtag, marketCacheId, PostgresMatchSnapshotRepository, statusForSync } from "./repository.js";

describe("supplier cache persistence helpers", () => {
  it("parses JSON-encoded market outcomes at the PostgreSQL boundary", async () => {
    const sql = (async () => [{
      productMarketId: "fixed-market", fixtureId: "openligadb:7001", supplier: "PLATFORM", supplierFixtureId: "7001",
      bookmakerId: "0", bookmakerName: "平台固定虚拟积分", supplierMarketId: "1", marketName: "胜平负固定积分倍率",
      currentVersion: "fixed-v1", dataAsOf: "2026-07-14T10:00:00.000Z", capturedAt: "2026-07-14T10:00:01.000Z",
      outcomes: JSON.stringify([{ selection: "HOME", supplierLabel: "主胜", decimalOdds: "3.00" }]),
    }]) as unknown as import("postgres").Sql;

    await expect(new PostgresMatchSnapshotRepository(sql).getOdds("openligadb:7001")).resolves.toMatchObject({
      outcomes: [{ selection: "HOME", decimalOdds: "3.00" }],
    });
  });

  it("normalizes PostgreSQL timestamp strings at the repository boundary", async () => {
    const sql = (async () => [{
      id: "api-football:101", supplier: "API_FOOTBALL", supplierFixtureId: "101", competitionId: "1", competitionName: "League",
      season: 2026, kickoffAt: "2026-07-14T20:00:00.000Z", status: "SCHEDULED", homeTeamId: "10", homeTeamName: "Home",
      awayTeamId: "20", awayTeamName: "Away", currentVersion: "fixture-v1", dataAsOf: "2026-07-14T10:00:00.000Z",
      capturedAt: "2026-07-14T10:00:01.000Z",
      oddsDataAsOf: "2026-07-14T09:58:00.000Z",
    }]) as unknown as import("postgres").Sql;
    const repository = new PostgresMatchSnapshotRepository(sql);

    await expect(repository.listFixtures()).resolves.toMatchObject([{
      kickoffAt: "2026-07-14T20:00:00.000Z",
      dataAsOf: "2026-07-14T10:00:00.000Z",
      capturedAt: "2026-07-14T10:00:01.000Z",
      oddsDataAsOf: "2026-07-14T09:58:00.000Z",
    }]);
  });

  it("returns a confirmed fixture result with the final score", async () => {
    const sql = (async () => [{
      id: "openligadb:7001", supplier: "OPENLIGADB", supplierFixtureId: "7001", competitionId: "501", competitionName: "世界杯",
      season: 2026, kickoffAt: "2026-07-14T20:00:00.000Z", status: "FINISHED", homeTeamId: "10", homeTeamName: "英格兰",
      awayTeamId: "20", awayTeamName: "阿根廷", currentVersion: "fixture-v2", dataAsOf: "2026-07-14T22:00:00.000Z",
      capturedAt: "2026-07-14T22:00:01.000Z", resultConfirmed: true, homeScore: 2, awayScore: 1, resultVersion: "result-v1",
    }]) as unknown as import("postgres").Sql;

    await expect(new PostgresMatchSnapshotRepository(sql).getFixture("openligadb:7001")).resolves.toMatchObject({
      status: "FINISHED",
      result: { confirmed: true, homeScore: 2, awayScore: 1, version: "result-v1" },
    });
  });

  it("maps a stored lineup snapshot back to the domain shape", async () => {
    const sql = (async () => [{
      fixtureId: "openligadb:7001", supplierFixtureId: "7001", status: "CONFIRMED",
      dataAsOf: "2026-07-19T18:30:00.000Z", capturedAt: "2026-07-19T18:30:01.000Z",
      home: JSON.stringify({ teamId: 10, name: "英格兰", logoUrl: null, primaryColor: null, formation: "4-3-3", coach: null, players: [] }),
      away: { teamId: 20, name: "阿根廷", logoUrl: null, primaryColor: null, formation: null, coach: null, players: [] },
    }]) as unknown as import("postgres").Sql;

    await expect(new PostgresMatchSnapshotRepository(sql).getLineup("openligadb:7001")).resolves.toMatchObject({
      fixtureId: "openligadb:7001",
      supplierFixtureId: 7001,
      status: "CONFIRMED",
      dataAsOf: "2026-07-19T18:30:00.000Z",
      capturedAt: "2026-07-19T18:30:01.000Z",
      home: { teamId: 10, name: "英格兰", formation: "4-3-3" },
      away: { teamId: 20, name: "阿根廷" },
    });
  });

  it("returns null instead of a partially corrupt lineup row", async () => {
    const sql = (async () => [{
      fixtureId: "openligadb:7001", supplierFixtureId: "7001", status: "CONFIRMED",
      dataAsOf: "2026-07-19T18:30:00.000Z", capturedAt: "2026-07-19T18:30:01.000Z",
      home: "not-json",
      away: { teamId: 20, name: "阿根廷", logoUrl: null, primaryColor: null, formation: null, coach: null, players: [] },
    }]) as unknown as import("postgres").Sql;

    await expect(new PostgresMatchSnapshotRepository(sql).getLineup("openligadb:7001")).resolves.toBeNull();
  });

  it("returns null when a lineup row is valid JSON but a player record is corrupt", async () => {
    const sql = (async () => [{
      fixtureId: "openligadb:7001", supplierFixtureId: "7001", status: "CONFIRMED",
      dataAsOf: "2026-07-19T18:30:00.000Z", capturedAt: "2026-07-19T18:30:01.000Z",
      home: JSON.stringify({
        teamId: 10, name: "英格兰", logoUrl: null, primaryColor: null, formation: "4-3-3", coach: null,
        players: [{ id: 1001, name: "英格兰一号", number: 1, position: "GOALIE", positionRaw: null, grid: null, photoUrl: null, starter: "yes", status: "STARTING" }],
      }),
      away: { teamId: 20, name: "阿根廷", logoUrl: null, primaryColor: null, formation: null, coach: null, players: [] },
    }]) as unknown as import("postgres").Sql;

    await expect(new PostgresMatchSnapshotRepository(sql).getLineup("openligadb:7001")).resolves.toBeNull();
  });

  it("guards lineup upserts so a stale capture cannot overwrite newer data", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...params: unknown[]) => {
      statements.push(strings.join("$"));
      values.push(params);
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;
    const clock = { now: () => new Date("2026-07-19T18:31:00.000Z") };

    await new PostgresMatchSnapshotRepository(sql, clock).saveLineup({
      fixtureId: "openligadb:7001", supplierFixtureId: 7001, status: "CONFIRMED",
      dataAsOf: "2026-07-19T18:30:00.000Z", capturedAt: "2026-07-19T18:30:01.000Z",
      home: { teamId: 10, name: "英格兰", logoUrl: null, primaryColor: null, formation: "4-3-3", coach: null, players: [] },
      away: { teamId: 20, name: "阿根廷", logoUrl: null, primaryColor: null, formation: null, coach: null, players: [] },
    });

    expect(statements[0]).toContain("INSERT INTO supplier.lineup_snapshots");
    expect(statements[0]).toContain("ON CONFLICT (fixture_id) DO UPDATE");
    expect(statements[0]).toContain("WHERE EXCLUDED.captured_at >= supplier.lineup_snapshots.captured_at");
    // 时间戳一律以 ISO 字符串进 postgres.js，避免 drizzle 改写 serializer 后裸 Date 崩溃
    expect(values[0]).toContain("2026-07-19T18:31:00.000Z");
    expect(values[0]?.every((param) => !(param instanceof Date))).toBe(true);
  });

  it("maps the freshness aggregate including PostgreSQL bigint counts and empty caches", async () => {
    const populated = (async () => [{
      lastCapturedAt: "2026-07-24T08:00:00.000Z", nextKickoffAt: "2026-08-07T18:30:00.000Z", nextKickoffCompetition: "德国足球甲级联赛",
      upcomingCount: "12", liveCount: "0", finishedRecentCount: "3",
    }]) as unknown as import("postgres").Sql;
    await expect(new PostgresMatchSnapshotRepository(populated).getFreshness()).resolves.toEqual({
      lastCapturedAt: "2026-07-24T08:00:00.000Z", nextKickoffAt: "2026-08-07T18:30:00.000Z", nextKickoffCompetition: "德国足球甲级联赛",
      upcomingCount: 12, liveCount: 0, finishedRecentCount: 3,
    });

    const empty = (async () => [{ lastCapturedAt: null, nextKickoffAt: null, nextKickoffCompetition: null, upcomingCount: "0", liveCount: "0", finishedRecentCount: "0" }]) as unknown as import("postgres").Sql;
    await expect(new PostgresMatchSnapshotRepository(empty).getFreshness()).resolves.toEqual({
      lastCapturedAt: null, nextKickoffAt: null, nextKickoffCompetition: null, upcomingCount: 0, liveCount: 0, finishedRecentCount: 0,
    });
  });

  it("bounds every list read-model query to the kickoff window while detail reads stay unbounded", async () => {
    const statements: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      statements.push(strings.join("$"));
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;
    const repository = new PostgresMatchSnapshotRepository(sql);

    await repository.listViewData();
    const window = "kickoff_at BETWEEN now() - make_interval(days => $) AND now() + make_interval(days => $)";
    // Fixtures plus four companions (odds, live, lineups, sync state). An
    // unbounded companion ships the whole season back for the join to discard.
    expect(statements).toHaveLength(5);
    for (const statement of statements) expect(statement).toContain(window);
    expect(statements.some((statement) => statement.includes("FROM supplier.live_snapshots"))).toBe(true);
    expect(statements.some((statement) => statement.includes("FROM supplier.lineup_snapshots"))).toBe(true);
    // The newest-per-market pick belongs in the database, not in a JS dedup over
    // every bookmaker row the table holds.
    expect(statements.some((statement) => statement.includes("DISTINCT ON (m.fixture_id,m.supplier_market_id)"))).toBe(true);

    statements.length = 0;
    await repository.getFixture("openligadb:7001");
    expect(statements[0]).toContain("FROM supplier.fixtures");
    expect(statements[0]).not.toContain("BETWEEN");
  });

  it("builds a stable market identity from supplier trace fields", () => {
    expect(marketCacheId("api-football:101", 8, 1)).toBe("api-football:101:bookmaker:8:market:1");
  });

  it("builds a strong deterministic cache ETag", () => {
    expect(cacheEtag({ version: "v1", outcomes: [{ selection: "HOME", decimalOdds: "2.10" }] })).toMatch(/^"[a-f0-9]{64}"$/);
    expect(cacheEtag({ version: "v1" })).toBe(cacheEtag({ version: "v1" }));
  });

  it("keeps any non-future verified snapshot open regardless of age or sync health", () => {
    const now = new Date("2026-07-13T10:00:00Z");
    expect(statusForSync("IDLE", true, new Date("2026-07-13T09:50:00Z"), now)).toBe("OPEN");
    expect(statusForSync("IDLE", true, new Date("2026-07-01T00:00:00Z"), now)).toBe("OPEN");
    expect(statusForSync("SYNCING", true, new Date("2026-07-01T00:00:00Z"), now)).toBe("OPEN");
    expect(statusForSync("FAILED", true, new Date("2026-07-01T00:00:00Z"), now)).toBe("OPEN");
    expect(statusForSync("IDLE", false, new Date("2026-07-13T10:00:00Z"), now)).toBe("DATA_UNAVAILABLE");
    expect(statusForSync("IDLE", true, new Date("2026-07-13T10:00:00.001Z"), now)).toBe("DATA_UNAVAILABLE");
    expect(statusForSync("IDLE", true, new Date("invalid"), now)).toBe("DATA_UNAVAILABLE");
  });
});
