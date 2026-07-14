import { describe, expect, it } from "vitest";
import { datasetNotice, filterMatches, groupMatches, matchAvailability, matchDateKey, paginateMatches, summarizeMatches } from "./match-filters.js";
import type { MatchView } from "./types.js";

const match = (id: string, competitionName: string, kickoffAt: string, state: MatchView["state"], stale = false): MatchView => ({
  id,
  competitionName,
  homeTeam: "Home",
  awayTeam: "Away",
  kickoffAt,
  state,
  stale,
  dataAsOf: "2026-07-14T08:00:00.000Z",
  market: state === "OPEN" ? { id, version: "1", home: "2.10", draw: "3.20", away: "3.40" } : undefined,
});

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
    const waitingForOdds = { ...match("4", "Serie A", "2026-07-16T18:00:00.000Z", "OPEN"), market: undefined };
    expect(summarizeMatches([...matches, waitingForOdds])).toEqual({ total: 4, open: 1, finished: 1, stale: 1 });
  });

  it("makes finished, stale, and unavailable fixtures explicitly non-predictable", () => {
    expect(matchAvailability(matches[1]!)).toMatchObject({ label: "已结束", predictable: false });
    expect(matchAvailability(matches[2]!)).toMatchObject({ label: "赔率已过期", predictable: false });
    expect(matchAvailability(match("4", "Serie A", "2026-07-16T18:00:00.000Z", "DATA_UNAVAILABLE"))).toMatchObject({ label: "数据不可用", predictable: false });
  });

  it("labels an archive-only feed as historical results rather than upcoming predictions", () => {
    expect(datasetNotice([matches[1]!])).toEqual({
      tone: "historical",
      title: "历史赛果",
      detail: "当前展示的是已完赛真实历史数据，仅用于浏览和功能验收，不能提交预测。",
    });
  });

  it("groups a large matchday by date and competition in kickoff order", () => {
    const grouped = groupMatches([
      match("3", "Premier League", "2026-07-15T18:00:00.000Z", "OPEN"),
      match("1", "La Liga", "2026-07-14T20:00:00.000Z", "OPEN"),
      match("2", "Premier League", "2026-07-14T12:00:00.000Z", "OPEN"),
    ], "UTC");

    expect(grouped.map((dateGroup) => ({
      date: dateGroup.date,
      competitions: dateGroup.competitions.map((competitionGroup) => ({
        name: competitionGroup.name,
        ids: competitionGroup.matches.map((item) => item.id),
      })),
    }))).toEqual([
      {
        date: "2026-07-14",
        competitions: [
          { name: "Premier League", ids: ["2"] },
          { name: "La Liga", ids: ["1"] },
        ],
      },
      { date: "2026-07-15", competitions: [{ name: "Premier League", ids: ["3"] }] },
    ]);
  });

  it("reveals large result sets in deterministic mobile-friendly batches", () => {
    const manyMatches = Array.from({ length: 53 }, (_, index) =>
      match(String(index), "League", `2026-07-14T${String(index % 24).padStart(2, "0")}:00:00.000Z`, "OPEN"),
    );

    expect(paginateMatches(manyMatches, 24)).toMatchObject({ shown: 24, total: 53, remaining: 29, hasMore: true });
    expect(paginateMatches(manyMatches, 48)).toMatchObject({ shown: 48, total: 53, remaining: 5, hasMore: true });
    expect(paginateMatches(manyMatches, 72)).toMatchObject({ shown: 53, total: 53, remaining: 0, hasMore: false });
  });
});
