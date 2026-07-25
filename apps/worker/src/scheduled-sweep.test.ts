import { describe, expect, it } from "vitest";
import { DEFAULT_OPENLIGADB_COMPETITIONS, parseOddsSyncIntervalMs, parseOpenLigaDbCompetitions, runScheduledSweepJob, validateScheduledSweepEnvironment } from "./scheduled-sweep.js";

describe("scheduled production sweep configuration", () => {
  it("requires the database and The Odds API key without including values in errors", () => {
    expect(() => validateScheduledSweepEnvironment({})).toThrow("DATABASE_URL, THE_ODDS_API_KEY");
    expect(() => validateScheduledSweepEnvironment({ DATABASE_URL: "database-secret", THE_ODDS_API_KEY: "odds-secret" })).not.toThrow();
    try { validateScheduledSweepEnvironment({ DATABASE_URL: "database-secret" }); }
    catch (error) { expect(String(error)).not.toContain("database-secret"); }
  });

  it("defaults to the live German season when OPENLIGADB_COMPETITIONS is unset", () => {
    const expected = [
      { shortcut: "bl1", season: 2026, oddsSportKey: "soccer_germany_bundesliga" },
      { shortcut: "bl2", season: 2026, oddsSportKey: "soccer_germany_bundesliga2" },
      { shortcut: "bl3", season: 2026, oddsSportKey: "soccer_germany_liga3" },
      { shortcut: "dfb", season: 2026 },
      { shortcut: "BLSupercup", season: 2026 },
    ];
    expect(parseOpenLigaDbCompetitions(undefined)).toEqual(expected);
    expect(parseOpenLigaDbCompetitions("")).toEqual(expected);
    expect(parseOpenLigaDbCompetitions("   ")).toEqual(expected);
    expect(validateScheduledSweepEnvironment({ DATABASE_URL: "db", THE_ODDS_API_KEY: "key" }).competitions).toEqual(expected);
  });

  /* A finished competition makes every sweep a no-op: no upcoming fixtures means no
     markets and no results, so the match list freezes and tickets never settle. */
  it("never defaults to a competition that has already finished", () => {
    expect(DEFAULT_OPENLIGADB_COMPETITIONS.map((competition) => competition.shortcut)).not.toContain("wm26");
  });

  /* Each distinct oddsSportKey costs one The-Odds-API credit per sync interval. */
  it("keeps the default real-odds footprint to the three league tiers", () => {
    const sportKeys = DEFAULT_OPENLIGADB_COMPETITIONS.flatMap((competition) => competition.oddsSportKey ?? []);
    expect(sportKeys).toHaveLength(3);
    expect(new Set(sportKeys).size).toBe(3);
  });

  it("treats an unset odds cadence as the supplier default and rejects nonsense", () => {
    expect(parseOddsSyncIntervalMs(undefined)).toBeUndefined();
    expect(parseOddsSyncIntervalMs("  ")).toBeUndefined();
    expect(parseOddsSyncIntervalMs("90")).toBe(90 * 60_000);
    for (const invalid of ["0", "-30", "12.5", "soon"]) {
      expect(() => parseOddsSyncIntervalMs(invalid), invalid).toThrow("ODDS_SYNC_INTERVAL_MINUTES");
    }
    expect(validateScheduledSweepEnvironment({ DATABASE_URL: "db", THE_ODDS_API_KEY: "key", ODDS_SYNC_INTERVAL_MINUTES: "120" }).oddsSyncIntervalMs).toBe(7_200_000);
  });

  it("parses comma-separated shortcut:season[:oddsSportKey] entries", () => {
    expect(parseOpenLigaDbCompetitions("wm26:2026:soccer_fifa_world_cup, bl1:2026:soccer_germany_bundesliga ,dfb:2026")).toEqual([
      { shortcut: "wm26", season: 2026, oddsSportKey: "soccer_fifa_world_cup" },
      { shortcut: "bl1", season: 2026, oddsSportKey: "soccer_germany_bundesliga" },
      { shortcut: "dfb", season: 2026 },
    ]);
    expect(validateScheduledSweepEnvironment({
      DATABASE_URL: "db", THE_ODDS_API_KEY: "key", OPENLIGADB_COMPETITIONS: "bl2:2026:soccer_germany_bundesliga2",
    }).competitions).toEqual([{ shortcut: "bl2", season: 2026, oddsSportKey: "soccer_germany_bundesliga2" }]);
  });

  it("rejects malformed OPENLIGADB_COMPETITIONS entries with a clear message", () => {
    for (const invalid of ["bl1", "bl1:26", "bl1:season", ":2026", "bl1:2026:", "bl1:2026:key:extra"]) {
      expect(() => parseOpenLigaDbCompetitions(invalid), invalid).toThrow(`Invalid OPENLIGADB_COMPETITIONS entry "${invalid}"`);
    }
    expect(() => validateScheduledSweepEnvironment({ DATABASE_URL: "db", THE_ODDS_API_KEY: "key", OPENLIGADB_COMPETITIONS: "bl1" })).toThrow("OPENLIGADB_COMPETITIONS");
  });

  it("locks due F1 sessions and settles completed events after the supplier sync", async () => {
    const calls: string[] = [];
    const result = await runScheduledSweepJob({
      sync: {
        run: async () => {
          calls.push("sync");
          return { fixturesUpserted: 2 };
        },
      },
      settlement: {
        lockDueF1Sessions: async (limit) => {
          calls.push(`f1-lock:${limit}`);
          return { outcome: "SUCCESS" as const, locked: 1, marketsClosed: 4 };
        },
        scan: async (limit) => {
          calls.push(`settlement:${limit}`);
          return { outcome: "SUCCESS" as const, processed: 3 };
        },
      },
    });

    expect(calls).toEqual(["sync", "f1-lock:500", "settlement:500"]);
    expect(result).toEqual({
      supplier: { fixturesUpserted: 2 },
      f1SessionLock: { outcome: "SUCCESS", locked: 1, marketsClosed: 4 },
      settlement: { outcome: "SUCCESS", processed: 3 },
    });
  });

  it("still locks and settles already-confirmed results when a supplier request fails", async () => {
    const calls: string[] = [];

    await expect(runScheduledSweepJob({
      sync: { run: async () => { throw new Error("sync failed"); } },
      settlement: {
        lockDueF1Sessions: async () => { calls.push("f1-lock"); },
        scan: async () => { calls.push("settlement"); },
      },
    })).rejects.toThrow("sync failed");

    expect(calls).toEqual(["f1-lock", "settlement"]);
  });

  it("works against a football-only settlement composition without an F1 lock", async () => {
    const result = await runScheduledSweepJob({
      sync: { run: async () => ({ fixturesUpserted: 1 }) },
      settlement: { scan: async () => ({ outcome: "SUCCESS" as const, processed: 0 }) },
    });

    expect(result.f1SessionLock).toBeNull();
  });
});
