import { describe, expect, it } from "vitest";
import { competitionFilterOptions, filterHistoryRecords, seasonCover, type CrossCompetitionRecord } from "./history-presentation.js";

const record = (ticketId: string, competitionId: string, name: string, season: number): CrossCompetitionRecord => ({
  ticketId,
  room: { id: "room-1", name: "老友局" },
  competition: { id: competitionId, name, season },
  fixture: { id: `fixture-${ticketId}`, homeTeam: "Home", awayTeam: "Away", kickoffAt: "2026-08-01T12:00:00.000Z" },
  selection: "HOME",
  stakePoints: "1000.00",
  settlement: { outcome: "WIN", grossReturnPoints: "2100.00", version: "result-v1", settledAt: "2026-08-01T15:00:00.000Z", ledgerId: "ledger-1", auditId: "audit-1" },
});

describe("history archive presentation", () => {
  const records = [record("ticket-1", "39", "Premier League", 2026), record("ticket-2", "2", "UEFA Champions League", 2026)];

  it("offers stable competition-season choices", () => {
    expect(competitionFilterOptions(records)).toEqual([
      { key: "2:2026", label: "UEFA Champions League · 2026" },
      { key: "39:2026", label: "Premier League · 2026" },
    ]);
  });

  it("filters records by competition and season while preserving all records for an empty filter", () => {
    expect(filterHistoryRecords(records, "2:2026").map((item) => item.ticketId)).toEqual(["ticket-2"]);
    expect(filterHistoryRecords(records, "")).toEqual(records);
  });
});

describe("seasonCover", () => {
  const summary = { settledTickets: 2, wins: 1, losses: 1, voids: 0 };
  const records = [record("ticket-1", "39", "Premier League", 2026), record("ticket-2", "2", "UEFA Champions League", 2026)];

  it("nets stake against gross return across every loaded record", () => {
    // 每条 record 都是 2100 返还 − 1000 投入 = +1100。
    expect(seasonCover(summary, records)).toMatchObject({ net: 2200, covered: 2, truncated: false });
  });

  it("flags a truncated archive instead of passing a partial sum off as the career total", () => {
    expect(seasonCover({ ...summary, settledTickets: 900 }, records)).toMatchObject({ covered: 2, truncated: true });
  });

  it("excludes voids from the hit-rate denominator and reports the sample size", () => {
    expect(seasonCover({ settledTickets: 10, wins: 3, losses: 1, voids: 6 }, records)).toMatchObject({ hitRate: 0.75, decided: 4 });
  });

  it("has no hit rate at all when nothing has been decided yet", () => {
    expect(seasonCover({ settledTickets: 2, wins: 0, losses: 0, voids: 2 }, records).hitRate).toBeNull();
  });

  it("labels a single season plainly and a multi-season archive as a range", () => {
    expect(seasonCover(summary, records).seasonLabel).toBe("2026");
    expect(seasonCover(summary, [...records, record("ticket-3", "39", "Premier League", 2025)]).seasonLabel).toBe("2025–2026");
    expect(seasonCover({ settledTickets: 0, wins: 0, losses: 0, voids: 0 }, []).seasonLabel).toBe("");
  });
});
