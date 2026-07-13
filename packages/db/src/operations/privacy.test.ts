import { describe, expect, it } from "vitest";
import { projectLeaderboard, projectLedgerEntry, redactTicketHistory } from "./repository.js";

const row = { ticketId: "t1", matchId: "f1", homeTeam: "A", awayTeam: "B", kickoffAt: new Date("2026-07-13T12:00:00Z"), submittedAt: new Date("2026-07-13T10:00:00Z"), ownerUserId: "bob", displayName: "Bob", selection: "HOME", stakePoints: "1000.00", confirmedOdds: "2.10", ticketStatus: "PENDING", outcome: null, grossReturnPoints: null, settlementVersion: null };

describe("ticket history privacy", () => {
  it("removes selection, stake, and odds for another member before server cutoff", () => {
    const result = redactTicketHistory(row, "alice", new Date("2026-07-13T11:59:59Z"));
    expect(result).toMatchObject({ visibility: "PRIVATE", owner: { isCurrentUser: false } });
    expect(result).not.toHaveProperty("selection"); expect(result).not.toHaveProperty("stakePoints"); expect(result).not.toHaveProperty("confirmedOdds");
  });
  it("always reveals the owner's ticket and reveals other members only at cutoff", () => {
    expect(redactTicketHistory(row, "bob", new Date("2026-07-13T10:01:00Z"))).toMatchObject({ visibility: "REVEALED", selection: "HOME" });
    expect(redactTicketHistory(row, "alice", new Date("2026-07-13T12:00:00Z"))).toMatchObject({ visibility: "REVEALED", selection: "HOME" });
  });

  it("explains a settled ticket with confirmed terms, return, net and result version", () => {
    const result = redactTicketHistory({ ...row, ticketStatus: "SETTLED", outcome: "WIN", grossReturnPoints: "2100.00", settlementVersion: "result-v3" }, "bob", new Date("2026-07-13T10:01:00Z"));
    expect(result).toMatchObject({
      selection: "HOME",
      stakePoints: "1000.00",
      confirmedOdds: "2.10",
      outcome: "WIN",
      returnPoints: "2100.00",
      netPoints: "+1100.00",
      settlementVersion: "result-v3",
      status: "WON",
    });
  });
});

describe("operations projections", () => {
  it("ranks by available points minus correction debt and excludes frozen points", () => {
    const result = projectLeaderboard([
      { userId: "alice", displayName: "Alice", availablePoints: "9000.00", frozenPoints: "2000.00", correctionDebt: "0.00", settledTickets: 0 },
      { userId: "bob", displayName: "Bob", availablePoints: "9500.00", frozenPoints: "0.00", correctionDebt: "0.00", settledTickets: 0 },
    ]);
    expect(result.map((row) => [row.userId, row.netPoints])).toEqual([["bob", "-500.00"], ["alice", "-1000.00"]]);
  });

  it("projects correction, re-settlement, refund and audit references without hiding debt", () => {
    const base = { id: "ledger-1", roomId: "room-1", kind: "SETTLEMENT", outcome: "WIN", createdAt: new Date("2026-07-13T12:30:00Z"), availableDelta: "1500.00", frozenDelta: "-1000.00", debtDelta: "-500.00", availableAfter: "1500.00", frozenAfter: "0.00", debtAfter: "0.00", ticketId: "ticket-1", settlementVersion: "result-v2", auditId: "audit-1", reversesLedgerId: null, hasPriorSettlement: true };
    expect(projectLedgerEntry(base)).toMatchObject({
      type: "RE_SETTLE",
      roomId: "room-1",
      ticketId: "ticket-1",
      settlementVersion: "result-v2",
      auditId: "audit-1",
      debtDelta: "-500.00",
    });
    expect(projectLedgerEntry(base).explanation).toContain("500.00");
    expect(projectLedgerEntry({ ...base, outcome: "CANCEL", hasPriorSettlement: false, debtDelta: "0.00" })).toMatchObject({ type: "VOID" });
    expect(projectLedgerEntry({ ...base, kind: "SETTLEMENT_REVERSAL", outcome: null, availableDelta: "-100.00", frozenDelta: "1000.00", debtDelta: "1900.00", reversesLedgerId: "ledger-0", hasPriorSettlement: false })).toMatchObject({ type: "REVERSAL", reversesLedgerId: "ledger-0" });
  });

  it("normalizes PostgreSQL timestamp strings at the API boundary", () => {
    const source = { id: "ledger-2", roomId: "room-1", kind: "INITIAL_GRANT", outcome: null, createdAt: "2026-07-13T12:30:00.000Z", availableDelta: "10000.00", frozenDelta: "0.00", debtDelta: "0.00", availableAfter: "10000.00", frozenAfter: "0.00", debtAfter: "0.00", ticketId: null, settlementVersion: null, auditId: "audit-2", reversesLedgerId: null, hasPriorSettlement: false };
    expect(projectLedgerEntry(source)).toMatchObject({ createdAt: "2026-07-13T12:30:00.000Z" });
  });
});
