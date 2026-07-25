import { describe, expect, it } from "vitest";
import { parseOpenLigaDbCompetitions, runCurrentWorldCupJob, validateCurrentWorldCupEnvironment } from "./current-world-cup.js";

describe("current World Cup free sync configuration", () => {
  it("requires the database and The Odds API key without including values in errors", () => {
    expect(() => validateCurrentWorldCupEnvironment({})).toThrow("DATABASE_URL, THE_ODDS_API_KEY");
    expect(() => validateCurrentWorldCupEnvironment({ DATABASE_URL: "database-secret", THE_ODDS_API_KEY: "odds-secret" })).not.toThrow();
    try { validateCurrentWorldCupEnvironment({ DATABASE_URL: "database-secret" }); }
    catch (error) { expect(String(error)).not.toContain("database-secret"); }
  });

  it("defaults to the historical World Cup competition when OPENLIGADB_COMPETITIONS is unset", () => {
    const expected = [{ shortcut: "wm26", season: 2026, oddsSportKey: "soccer_fifa_world_cup" }];
    expect(parseOpenLigaDbCompetitions(undefined)).toEqual(expected);
    expect(parseOpenLigaDbCompetitions("")).toEqual(expected);
    expect(parseOpenLigaDbCompetitions("   ")).toEqual(expected);
    expect(validateCurrentWorldCupEnvironment({ DATABASE_URL: "db", THE_ODDS_API_KEY: "key" }).competitions).toEqual(expected);
  });

  it("parses comma-separated shortcut:season[:oddsSportKey] entries", () => {
    expect(parseOpenLigaDbCompetitions("wm26:2026:soccer_fifa_world_cup, bl1:2026:soccer_germany_bundesliga ,dfb:2026")).toEqual([
      { shortcut: "wm26", season: 2026, oddsSportKey: "soccer_fifa_world_cup" },
      { shortcut: "bl1", season: 2026, oddsSportKey: "soccer_germany_bundesliga" },
      { shortcut: "dfb", season: 2026 },
    ]);
    expect(validateCurrentWorldCupEnvironment({
      DATABASE_URL: "db", THE_ODDS_API_KEY: "key", OPENLIGADB_COMPETITIONS: "bl2:2026:soccer_germany_bundesliga2",
    }).competitions).toEqual([{ shortcut: "bl2", season: 2026, oddsSportKey: "soccer_germany_bundesliga2" }]);
  });

  it("rejects malformed OPENLIGADB_COMPETITIONS entries with a clear message", () => {
    for (const invalid of ["bl1", "bl1:26", "bl1:season", ":2026", "bl1:2026:", "bl1:2026:key:extra"]) {
      expect(() => parseOpenLigaDbCompetitions(invalid), invalid).toThrow(`Invalid OPENLIGADB_COMPETITIONS entry "${invalid}"`);
    }
    expect(() => validateCurrentWorldCupEnvironment({ DATABASE_URL: "db", THE_ODDS_API_KEY: "key", OPENLIGADB_COMPETITIONS: "bl1" })).toThrow("OPENLIGADB_COMPETITIONS");
  });

  it("settles completed fixtures immediately after the supplier sync", async () => {
    const calls: string[] = [];
    const result = await runCurrentWorldCupJob({
      sync: {
        run: async () => {
          calls.push("sync");
          return { fixturesUpserted: 2 };
        },
      },
      settlement: {
        scan: async (limit) => {
          calls.push(`settlement:${limit}`);
          return { outcome: "SUCCESS" as const, processed: 3 };
        },
      },
    });

    expect(calls).toEqual(["sync", "settlement:500"]);
    expect(result).toEqual({
      supplier: { fixturesUpserted: 2 },
      settlement: { outcome: "SUCCESS", processed: 3 },
    });
  });

  it("still settles already-confirmed results when a supplier request fails", async () => {
    let settlementRan = false;

    await expect(runCurrentWorldCupJob({
      sync: { run: async () => { throw new Error("sync failed"); } },
      settlement: { scan: async () => { settlementRan = true; } },
    })).rejects.toThrow("sync failed");

    expect(settlementRan).toBe(true);
  });
});
