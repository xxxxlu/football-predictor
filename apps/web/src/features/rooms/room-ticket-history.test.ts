import { describe, expect, it } from "vitest";
import { toTicketHistoryView, type TicketHistoryRecord } from "./room-ticket-history.js";

const base = {
  ticketId: "ticket-1", matchId: "match-1", homeTeam: "法国", awayTeam: "西班牙",
  kickoffAt: "2026-07-15T19:00:00.000Z", submitted: true as const,
  owner: { userId: "user-2", displayName: "小明", isCurrentUser: false },
  status: "FROZEN" as const,
};

describe("room ticket history presentation", () => {
  it("does not infer hidden ticket fields", () => {
    expect(toTicketHistoryView({ ...base, visibility: "PRIVATE" })).toMatchObject({ disclosure: "已提交，详情未公开", stake: null, selection: null, odds: null });
  });

  it("shows stake only before kickoff when the platform setting permits it", () => {
    const record: TicketHistoryRecord = { ...base, visibility: "STAKE_ONLY", submittedAt: "2026-07-15T18:00:00.000Z", stakePoints: "2000.00" };
    expect(toTicketHistoryView(record)).toMatchObject({ disclosure: "已公开投入", stake: "2,000", selection: null, odds: null });
  });

  it("shows full confirmed terms only for revealed records", () => {
    const record: TicketHistoryRecord = { ...base, owner: { ...base.owner, isCurrentUser: true }, visibility: "REVEALED", submittedAt: "2026-07-15T18:00:00.000Z", stakePoints: "2000.00", selection: "AWAY", confirmedOdds: "2.45", outcome: null, returnPoints: null, netPoints: null, settlementVersion: null };
    expect(toTicketHistoryView(record)).toMatchObject({ ownerLabel: "我的记录", disclosure: "完整记录", stake: "2,000", selection: "客胜", odds: "2.45" });
  });
});
