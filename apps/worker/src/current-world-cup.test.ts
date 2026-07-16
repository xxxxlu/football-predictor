import { describe, expect, it } from "vitest";
import { runCurrentWorldCupJob, validateCurrentWorldCupEnvironment } from "./current-world-cup.js";

describe("current World Cup free sync configuration", () => {
  it("requires the database and The Odds API key without including values in errors", () => {
    expect(() => validateCurrentWorldCupEnvironment({})).toThrow("DATABASE_URL, THE_ODDS_API_KEY");
    expect(() => validateCurrentWorldCupEnvironment({ DATABASE_URL: "database-secret", THE_ODDS_API_KEY: "odds-secret" })).not.toThrow();
    try { validateCurrentWorldCupEnvironment({ DATABASE_URL: "database-secret" }); }
    catch (error) { expect(String(error)).not.toContain("database-secret"); }
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
