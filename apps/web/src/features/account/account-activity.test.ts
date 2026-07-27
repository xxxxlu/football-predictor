import { describe, expect, it } from "vitest";
import { accountTicketSummary, ownTickets, signedPoints, type AccountTicket } from "./account-activity";

const ticket = (status: AccountTicket["status"], current = true): AccountTicket => ({
  ticketId: `${status}-${current}`, homeTeam: "英格兰", awayTeam: "阿根廷", submittedAt: "2026-07-15T07:00:00Z",
  owner: { isCurrentUser: current }, status,
});

describe("account activity presentation", () => {
  it("keeps only the signed-in user's room tickets", () => {
    expect(ownTickets([ticket("FROZEN"), ticket("WON", false)])).toEqual([ticket("FROZEN")]);
  });

  it("separates pending predictions from settled predictions", () => {
    expect(accountTicketSummary([ticket("FROZEN"), ticket("WON"), ticket("LOST")])).toEqual({ total: 3, pending: 1, settled: 2 });
  });

  it("formats point deltas with an explicit positive sign", () => {
    expect(signedPoints("25")).toBe("+25");
    expect(signedPoints("-10")).toBe("-10");
    expect(signedPoints(null)).toBe("0");
  });
});
