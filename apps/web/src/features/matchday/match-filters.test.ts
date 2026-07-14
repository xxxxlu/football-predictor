import { describe, expect, it } from "vitest";
import { filterMatches, matchAvailability, matchDateKey, summarizeMatches } from "./match-filters.js";
import type { MatchView } from "./types.js";

const match = (id: string, competitionName: string, kickoffAt: string, state: MatchView["state"], stale = false): MatchView => ({ id, competitionName, homeTeam: "Home", awayTeam: "Away", kickoffAt, state, stale, dataAsOf: "2026-07-14T08:00:00.000Z" });

describe("multi-match filters", () => {
  const matches = [
    match("1", "Premier League", "2026-07-14T12:00:00.000Z", "OPEN"),
    match("2", "La Liga", "2026-07-15T12:00:00.000Z", "FINISHED"),
    match("3", "Premier League", "2026-07-15T18:00:00.000Z", "DATA_UNAVAILABLE", true),
  ];

  it("filters by real competition name and local match date without assuming a tournament", () => {
    expect(filterMatches(matches, { competition: "Premier League", date: "2026-07-15", timeZone: "UTC" }).map((item) => item.id)).toEqual(["3"]);
    expect(matchDateKey(matches[0]!, "UTC")).toBe("2026-07-14");
  });

  it("summarizes visible, open, finished, and stale counts", () => {
    expect(summarizeMatches(matches)).toEqual({ total: 3, open: 1, finished: 1, stale: 1 });
  });

  it("makes finished, stale, and unavailable fixtures explicitly non-predictable", () => {
    expect(matchAvailability(matches[1]!)).toMatchObject({ label: "已结束", predictable: false });
    expect(matchAvailability(matches[2]!)).toMatchObject({ label: "赔率已过期", predictable: false });
    expect(matchAvailability(match("4", "Serie A", "2026-07-16T18:00:00.000Z", "DATA_UNAVAILABLE"))).toMatchObject({ label: "数据不可用", predictable: false });
  });
});
