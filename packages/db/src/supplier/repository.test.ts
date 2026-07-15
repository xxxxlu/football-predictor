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
