import { describe, expect, it } from "vitest";
import { competitionFilterOptions, filterHistoryRecords, type CrossCompetitionRecord } from "./history-presentation.js";

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
