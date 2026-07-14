import { describe, expect, it } from "vitest";
import { validateCurrentWorldCupEnvironment } from "./current-world-cup.js";

describe("current World Cup free sync configuration", () => {
  it("requires the database and The Odds API key without including values in errors", () => {
    expect(() => validateCurrentWorldCupEnvironment({})).toThrow("DATABASE_URL, THE_ODDS_API_KEY");
    expect(() => validateCurrentWorldCupEnvironment({ DATABASE_URL: "database-secret", THE_ODDS_API_KEY: "odds-secret" })).not.toThrow();
    try { validateCurrentWorldCupEnvironment({ DATABASE_URL: "database-secret" }); }
    catch (error) { expect(String(error)).not.toContain("database-secret"); }
  });
});
