import { describe, expect, it } from "vitest";
import { cacheEtag, marketCacheId, PostgresMatchSnapshotRepository, statusForSync } from "./repository.js";

describe("supplier cache persistence helpers", () => {
  it("normalizes PostgreSQL timestamp strings at the repository boundary", async () => {
    const sql = (async () => [{
      id: "api-football:101", supplier: "API_FOOTBALL", supplierFixtureId: "101", competitionId: "1", competitionName: "League",
      season: 2026, kickoffAt: "2026-07-14T20:00:00.000Z", status: "SCHEDULED", homeTeamId: "10", homeTeamName: "Home",
      awayTeamId: "20", awayTeamName: "Away", currentVersion: "fixture-v1", dataAsOf: "2026-07-14T10:00:00.000Z",
      capturedAt: "2026-07-14T10:00:01.000Z",
    }]) as unknown as import("postgres").Sql;
    const repository = new PostgresMatchSnapshotRepository(sql);

    await expect(repository.listFixtures()).resolves.toMatchObject([{
      kickoffAt: "2026-07-14T20:00:00.000Z",
      dataAsOf: "2026-07-14T10:00:00.000Z",
      capturedAt: "2026-07-14T10:00:01.000Z",
    }]);
  });

  it("builds a stable market identity from supplier trace fields", () => {
    expect(marketCacheId("api-football:101", 8, 1)).toBe("api-football:101:bookmaker:8:market:1");
  });

  it("builds a strong deterministic cache ETag", () => {
    expect(cacheEtag({ version: "v1", outcomes: [{ selection: "HOME", decimalOdds: "2.10" }] })).toMatch(/^"[a-f0-9]{64}"$/);
    expect(cacheEtag({ version: "v1" })).toBe(cacheEtag({ version: "v1" }));
  });

  it("only reopens an idle, verified and fresh market", () => {
    const now = new Date("2026-07-13T10:00:00Z");
    expect(statusForSync("IDLE", true, new Date("2026-07-13T09:50:00Z"), now)).toBe("OPEN");
    expect(statusForSync("IDLE", true, new Date("2026-07-13T09:49:59.999Z"), now)).toBe("DATA_UNAVAILABLE");
    expect(statusForSync("SYNCING", true, new Date("2026-07-13T10:00:00Z"), now)).toBe("DATA_UNAVAILABLE");
    expect(statusForSync("IDLE", false, new Date("2026-07-13T10:00:00Z"), now)).toBe("DATA_UNAVAILABLE");
  });
});
