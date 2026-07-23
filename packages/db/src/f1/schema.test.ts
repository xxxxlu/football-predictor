import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { f1Constructors, f1Drivers, f1MarketOdds, f1Markets, f1RaceWeekends, f1SessionResults, f1Sessions } from "./schema.js";

describe("f1 persistence schema", () => {
  it("keeps one weekend per season round and one session per weekend kind", () => {
    const weekends = getTableConfig(f1RaceWeekends);
    expect(weekends.uniqueConstraints.some((constraint) => constraint.columns.map((column) => column.name).join(",") === "season,round")).toBe(true);
    const sessions = getTableConfig(f1Sessions);
    expect(sessions.uniqueConstraints.some((constraint) => constraint.columns.map((column) => column.name).join(",") === "weekend_id,kind")).toBe(true);
  });

  it("keeps one market per session kind and versions odds immutably", () => {
    const markets = getTableConfig(f1Markets);
    expect(markets.uniqueConstraints.some((constraint) => constraint.columns.map((column) => column.name).join(",") === "session_id,kind")).toBe(true);
    const odds = getTableConfig(f1MarketOdds);
    expect(odds.primaryKeys.some((key) => key.columns.map((column) => column.name).join(",") === "market_id,version")).toBe(true);
    expect(odds.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["data_as_of", "outcomes"]));
  });

  it("versions session results per session with attribution for admin entry", () => {
    const results = getTableConfig(f1SessionResults);
    expect(results.primaryKeys.some((key) => key.columns.map((column) => column.name).join(",") === "session_id,version")).toBe(true);
    expect(results.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["classification", "entered_by", "entered_at", "confirmed_at"]));
  });

  it("stores the entry list with team identity and H2H pricing points", () => {
    expect(getTableConfig(f1Constructors).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["key", "name", "color"]));
    expect(getTableConfig(f1Drivers).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["code", "number", "constructor_key", "active", "season_points"]),
    );
  });
});
