import { describe, expect, it } from "vitest";
import { projectLeaderboard, projectLedgerEntry, redactTicketHistory } from "./repository.js";

const row = { ticketId: "t1", matchId: "f1", homeTeam: "A", awayTeam: "B", kickoffAt: new Date("2026-07-13T12:00:00Z"), submittedAt: new Date("2026-07-13T10:00:00Z"), ownerUserId: "bob", displayName: "Bob", selection: "HOME", stakePoints: "1000.00", confirmedOdds: "2.10", ticketStatus: "PENDING", outcome: null, grossReturnPoints: null, settlementVersion: null };
const defaults = { preMatchStakeVisible: false, postMatchTicketVisible: true };

describe("ticket history privacy", () => {
  it("removes selection, stake, and odds for another member before server cutoff", () => {
    const result = redactTicketHistory(row, "alice", new Date("2026-07-13T11:59:59Z"), defaults);
    expect(result).toMatchObject({ visibility: "PRIVATE", owner: { isCurrentUser: false } });
    expect(result).not.toHaveProperty("selection"); expect(result).not.toHaveProperty("stakePoints"); expect(result).not.toHaveProperty("confirmedOdds"); expect(result).not.toHaveProperty("submittedAt"); expect(result).not.toHaveProperty("outcome");
  });

  it("reveals only stake and submission time before kickoff when the platform switch is on", () => {
    const result = redactTicketHistory(row, "alice", new Date("2026-07-13T11:59:59Z"), { ...defaults, preMatchStakeVisible: true });
    expect(result).toMatchObject({ visibility: "STAKE_ONLY", stakePoints: "1000.00", submittedAt: "2026-07-13T10:00:00.000Z" });
    expect(result).not.toHaveProperty("selection"); expect(result).not.toHaveProperty("confirmedOdds"); expect(result).not.toHaveProperty("outcome");
  });

  it("always reveals the owner's ticket and follows the room switch after cutoff", () => {
    expect(redactTicketHistory(row, "bob", new Date("2026-07-13T10:01:00Z"), defaults)).toMatchObject({ visibility: "REVEALED", selection: "HOME" });
    expect(redactTicketHistory(row, "alice", new Date("2026-07-13T12:00:00Z"), defaults)).toMatchObject({ visibility: "REVEALED", selection: "HOME" });
    const hidden = redactTicketHistory(row, "alice", new Date("2026-07-13T12:00:00Z"), { ...defaults, postMatchTicketVisible: false });
    expect(hidden).toMatchObject({ visibility: "PRIVATE", submitted: true });
    expect(hidden).not.toHaveProperty("stakePoints"); expect(hidden).not.toHaveProperty("settlementVersion");
  });

  it("explains a settled ticket with confirmed terms, return, net and result version", () => {
    const result = redactTicketHistory({ ...row, ticketStatus: "SETTLED", outcome: "WIN", grossReturnPoints: "2100.00", settlementVersion: "result-v3" }, "bob", new Date("2026-07-13T10:01:00Z"), defaults);
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

  /* Story 12.6: the leaderboard row gained the avatar pair and nothing else — no
     object key, no public id, and none of the balance internals it ranks on. */
  it("carries only the avatar pair onto a leaderboard row", () => {
    const [row] = projectLeaderboard([
      { userId: "alice", displayName: "Alice", availablePoints: "9000.00", frozenPoints: "0.00", correctionDebt: "0.00", settledTickets: 1, avatarPublicId: "7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607", avatarVersion: 5 },
    ]);
    expect(row).toMatchObject({ avatarUrl: "/api/v1/media/avatars/7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607/5.webp", avatarVersion: 5 });
    expect(Object.keys(row!)).not.toContain("avatarPublicId");
    expect(Object.keys(row!)).not.toContain("objectKey");

    const [without] = projectLeaderboard([
      { userId: "bob", displayName: "Bob", availablePoints: "9000.00", frozenPoints: "0.00", correctionDebt: "0.00", settledTickets: 0 },
    ]);
    expect(without).toMatchObject({ avatarUrl: null, avatarVersion: null });
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
