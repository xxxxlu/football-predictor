import { describe, expect, it } from "vitest";
import { projectCrossCompetitionHistory, type CrossCompetitionHistoryRow } from "./repository.js";

const row = (overrides: Partial<CrossCompetitionHistoryRow> = {}): CrossCompetitionHistoryRow => ({
  ticketId: "ticket-1",
  roomId: "room-1",
  roomName: "老友局",
  fixtureId: "fixture-1",
  competitionId: "39",
  competitionName: "Premier League",
  season: 2026,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  kickoffAt: "2026-08-15T12:00:00.000Z",
  selection: "HOME",
  stakePoints: "1000.00",
  outcome: "WIN",
  grossReturnPoints: "2100.00",
  settlementVersion: "result-v2",
  settledAt: "2026-08-15T15:00:00.000Z",
  ledgerId: "ledger-1",
  auditId: "audit-1",
  ...overrides,
});

describe("cross-competition history projection", () => {
  it("groups the current user's active settlements by competition and season", () => {
    const archive = projectCrossCompetitionHistory([
      row(),
      row({ ticketId: "ticket-2", roomId: "room-2", roomName: "办公室", outcome: "LOSS", grossReturnPoints: "0.00", ledgerId: "ledger-2", auditId: "audit-2" }),
      row({ ticketId: "ticket-3", fixtureId: "fixture-3", competitionId: "2", competitionName: "UEFA Champions League", season: 2026, outcome: "PUSH", grossReturnPoints: "1000.00", ledgerId: "ledger-3", auditId: "audit-3" }),
    ]);

    expect(archive.scope).toEqual({ performance: "USER_CROSS_COMPETITION", balances: "PER_ROOM" });
    expect(archive.summary).toEqual({ settledTickets: 3, wins: 1, losses: 1, voids: 1 });
    expect(archive.competitions).toEqual([
      { competitionId: "39", competitionName: "Premier League", season: 2026, settledTickets: 2, wins: 1, losses: 1, voids: 0 },
      { competitionId: "2", competitionName: "UEFA Champions League", season: 2026, settledTickets: 1, wins: 0, losses: 0, voids: 1 },
    ]);
  });

  it("keeps room identity and versioned ledger evidence on every record without merging balances", () => {
    const archive = projectCrossCompetitionHistory([row()]);

    expect(archive.records[0]).toMatchObject({
      ticketId: "ticket-1",
      room: { id: "room-1", name: "老友局" },
      settlement: { outcome: "WIN", version: "result-v2", ledgerId: "ledger-1", auditId: "audit-1" },
    });
    expect(archive.records[0]).not.toHaveProperty("balance");
    expect(archive.summary).not.toHaveProperty("points");
  });
});
