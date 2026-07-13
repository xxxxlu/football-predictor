import { describe, expect, it } from "vitest";
import { redactTicketHistory } from "./repository.js";

const row = { ticketId: "t1", matchId: "f1", homeTeam: "A", awayTeam: "B", kickoffAt: new Date("2026-07-13T12:00:00Z"), submittedAt: new Date("2026-07-13T10:00:00Z"), ownerUserId: "bob", displayName: "Bob", selection: "HOME", stakePoints: "1000.00", confirmedOdds: "2.10", ticketStatus: "PENDING" };

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
});
