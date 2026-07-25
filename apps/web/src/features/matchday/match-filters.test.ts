import { describe, expect, it } from "vitest";
import { datasetNotice, filterMatches, freshnessNotice, groupMatches, matchAvailability, matchDateKey, paginateMatches, sortMatchesForDisplay, summarizeMatches } from "./match-filters.js";
import type { FreshnessMeta, MatchView } from "./types.js";

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

  it("filters all, predictable, and finished match states", () => {
    expect(filterMatches(matches, { status: "ALL" }).map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(filterMatches(matches, { status: "PREDICTABLE" }).map((item) => item.id)).toEqual(["1"]);
    expect(filterMatches(matches, { status: "FINISHED" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("orders current matches first and finished matches newest first", () => {
    const ordered = sortMatchesForDisplay([
      match("old-result", "World Cup", "2026-06-11T12:00:00.000Z", "FINISHED"),
      match("later", "World Cup", "2026-07-16T12:00:00.000Z", "OPEN"),
      match("new-result", "World Cup", "2026-07-14T12:00:00.000Z", "FINISHED"),
      match("sooner", "World Cup", "2026-07-15T12:00:00.000Z", "OPEN"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["sooner", "later", "new-result", "old-result"]);
  });

  it("summarizes visible, open, finished, and stale counts", () => {
    const waitingForOdds = { ...match("4", "Serie A", "2026-07-16T18:00:00.000Z", "OPEN"), market: undefined };
    expect(summarizeMatches([...matches, waitingForOdds])).toEqual({ total: 4, open: 1, finished: 1, stale: 1 });
  });

  it("keeps a last-known snapshot predictable while blocking finished and unavailable fixtures", () => {
    const lastKnown = match("last-known", "World Cup", "2026-07-16T03:00:00.000Z", "OPEN", true);
    expect(matchAvailability(matches[1]!)).toMatchObject({ label: "已结束", predictable: false });
    expect(matchAvailability(lastKnown)).toMatchObject({ label: "使用最后有效赔率", predictable: true });
    expect(matchAvailability(match("4", "Serie A", "2026-07-16T18:00:00.000Z", "DATA_UNAVAILABLE"))).toMatchObject({ label: "数据不可用", predictable: false });
  });

  it("labels an archive-only feed as historical results rather than upcoming predictions", () => {
    expect(datasetNotice([matches[1]!])).toEqual({
      tone: "historical",
      title: "历史赛果",
      detail: "当前展示的是已完赛真实历史数据，仅用于浏览和功能验收，不能提交预测。",
    });
  });

  it("groups matches by competition before date in kickoff order", () => {
    const grouped = groupMatches([
      match("3", "Premier League", "2026-07-15T18:00:00.000Z", "OPEN"),
      match("1", "La Liga", "2026-07-14T20:00:00.000Z", "OPEN"),
      match("2", "Premier League", "2026-07-14T12:00:00.000Z", "OPEN"),
    ], "UTC");

    expect(grouped.map((competitionGroup) => ({
      name: competitionGroup.name,
      dates: competitionGroup.dates.map((dateGroup) => ({
        date: dateGroup.date,
        ids: dateGroup.matches.map((item) => item.id),
      })),
    }))).toEqual([
      {
        name: "Premier League",
        dates: [
          { date: "2026-07-14", ids: ["2"] },
          { date: "2026-07-15", ids: ["3"] },
        ],
      },
      { name: "La Liga", dates: [{ date: "2026-07-14", ids: ["1"] }] },
    ]);
  });

  it("decides the freshness banner lines from real metadata only", () => {
    const now = new Date("2026-07-24T10:00:00Z");
    const meta = (overrides: Partial<FreshnessMeta> = {}): FreshnessMeta => ({
      lastCapturedAt: "2026-07-24T08:00:00.000Z", nextKickoffAt: null, nextKickoffCompetition: null,
      upcomingCount: 0, liveCount: 0, finishedRecentCount: 0, ...overrides,
    });

    // 1. Fresh data with predictable upcoming matches: capture time only, no "next match" line, no warning.
    expect(freshnessNotice({ freshness: meta({ upcomingCount: 3, nextKickoffAt: "2026-07-25T12:00:00.000Z", nextKickoffCompetition: "德国足球甲级联赛" }), matches, now }))
      .toEqual({ lastCapturedAt: "2026-07-24T08:00:00.000Z", stale: false, nextMatch: null });

    // 2. Nothing live or predictable but a future kickoff exists: announce the next match.
    expect(freshnessNotice({ freshness: meta({ upcomingCount: 1, nextKickoffAt: "2026-08-07T18:30:00.000Z", nextKickoffCompetition: "德国足球甲级联赛" }), matches: [], now }))
      .toEqual({ lastCapturedAt: "2026-07-24T08:00:00.000Z", stale: false, nextMatch: { kickoffAt: "2026-08-07T18:30:00.000Z", competitionName: "德国足球甲级联赛" } });

    // 3. Supplier cache older than 48 hours: raise the health warning (boundary at exactly 48h stays calm).
    expect(freshnessNotice({ freshness: meta({ lastCapturedAt: "2026-07-21T10:00:00.000Z" }), matches: [], now })).toMatchObject({ stale: true });
    expect(freshnessNotice({ freshness: meta({ lastCapturedAt: "2026-07-22T10:00:00.000Z" }), matches: [], now })).toMatchObject({ stale: false });

    // 4. All-finished historical archive with no next kickoff: nothing is invented.
    const finishedOnly = [match("2", "La Liga", "2026-07-15T12:00:00.000Z", "FINISHED")];
    expect(freshnessNotice({ freshness: meta({ finishedRecentCount: 1 }), matches: finishedOnly, now }))
      .toEqual({ lastCapturedAt: "2026-07-24T08:00:00.000Z", stale: false, nextMatch: null });

    // No metadata at all: the banner extension stays hidden.
    expect(freshnessNotice({ freshness: null, matches, now })).toBeNull();
    // A live match blocks the "no ongoing competition" line even when nothing is predictable locally.
    expect(freshnessNotice({ freshness: meta({ liveCount: 1, nextKickoffAt: "2026-08-07T18:30:00.000Z" }), matches: [], now })).toMatchObject({ nextMatch: null });
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
