import { describe, expect, it } from "vitest";
import { grantCreateRequest, grantDecisionRequest, grantErrorMessage, splitGrantList, summarizeApprovedGrants, type GrantRecord } from "./room-grants";

const record = (overrides: Partial<GrantRecord>): GrantRecord => ({
  id: "g-1", roomId: "room-1", requester: { userId: "alice", displayName: "Alice" },
  note: null, status: "OPEN", requestedAt: "2026-08-12T10:00:00.000Z",
  decidedAt: null, approvedAmount: null, decisionNote: null, ...overrides,
});

describe("grant request builders", () => {
  it("omits an empty note and encodes ids", () => {
    const create = grantCreateRequest("room/1", "  ");
    expect(create.url).toBe("/api/v1/rooms/room%2F1/grants");
    expect(create.init.body).toBe("{}");
    expect(grantCreateRequest("room-1", " 需要补分 ").init.body).toBe(JSON.stringify({ note: "需要补分" }));
  });

  it("carries the amount only on approvals", () => {
    const approve = grantDecisionRequest("room-1", "g-1", { action: "APPROVE", amount: 2500 });
    expect(JSON.parse(approve.init.body)).toEqual({ action: "APPROVE", amount: 2500 });
    const deny = grantDecisionRequest("room-1", "g-1", { action: "DENY", note: " 本轮先不补 " });
    expect(JSON.parse(deny.init.body)).toEqual({ action: "DENY", note: "本轮先不补" });
  });
});

describe("grantErrorMessage", () => {
  it("maps contract codes to Chinese copy and falls back for unknown codes", () => {
    expect(grantErrorMessage("GRANT_REQUEST_EXISTS", "失败")).toContain("待处理");
    expect(grantErrorMessage("NO_SUCH_CODE", "失败")).toBe("失败");
    expect(grantErrorMessage(undefined, "失败")).toBe("失败");
  });

  it("covers the server's envelope codes so English messages never leak", () => {
    for (const code of ["UNAUTHENTICATED", "INVALID_ORIGIN", "INVALID_REQUEST", "INTERNAL_ERROR"]) {
      expect(grantErrorMessage(code, "Log in to continue.")).toMatch(/[一-鿿]/);
    }
  });
});

describe("splitGrantList", () => {
  it("treats the only OPEN row as the member's own pending request", () => {
    const split = splitGrantList({ isOwner: false, requests: [record({}), record({ id: "g-2", status: "APPROVED", approvedAmount: "1000.00" })] });
    expect(split.minePending?.id).toBe("g-1");
    expect(split.approved).toHaveLength(1);
  });

  it("never marks a pending row as the owner's own", () => {
    const split = splitGrantList({ isOwner: true, requests: [record({})] });
    expect(split.minePending).toBeUndefined();
    expect(split.open).toHaveLength(1);
  });

  it("surfaces the member's latest denial only while no later request was approved", () => {
    const denied = record({ id: "g-1", status: "DENIED", decidedAt: "2026-08-10T10:00:00.000Z", decisionNote: "本轮先不补" });
    const olderDenied = record({ id: "g-0", status: "DENIED", decidedAt: "2026-08-01T10:00:00.000Z" });
    // Standing denial: the newest DENIED row wins and is shown.
    expect(splitGrantList({ isOwner: false, requests: [olderDenied, denied] }).mineDenied?.id).toBe("g-1");
    // A later own approval retires the banner...
    const approvedLater = record({ id: "g-2", status: "APPROVED", approvedAmount: "500.00", decidedAt: "2026-08-11T10:00:00.000Z" });
    expect(splitGrantList({ isOwner: false, requests: [denied, approvedLater] }).mineDenied).toBeUndefined();
    // ...but another member's approval does not.
    const someoneElse = record({ id: "g-3", status: "APPROVED", approvedAmount: "500.00", decidedAt: "2026-08-11T10:00:00.000Z", requester: { userId: "bob", displayName: "Bob" } });
    expect(splitGrantList({ isOwner: false, requests: [denied, someoneElse] }).mineDenied?.id).toBe("g-1");
    // The owner surface never shows the member banner.
    expect(splitGrantList({ isOwner: true, requests: [denied] }).mineDenied).toBeUndefined();
  });
});

describe("summarizeApprovedGrants", () => {
  it("aggregates counts and totals per member, largest first (FR44)", () => {
    const summary = summarizeApprovedGrants([
      record({ id: "g-1", status: "APPROVED", approvedAmount: "1000.00" }),
      record({ id: "g-2", status: "APPROVED", approvedAmount: "500.00" }),
      record({ id: "g-3", status: "APPROVED", approvedAmount: "2000.00", requester: { userId: "bob", displayName: "Bob" } }),
      record({ id: "g-4" }), // OPEN rows never count
      record({ id: "g-5", status: "DENIED" }),
    ]);
    expect(summary).toEqual([
      { userId: "bob", displayName: "Bob", count: 1, totalPoints: 2000 },
      { userId: "alice", displayName: "Alice", count: 2, totalPoints: 1500 },
    ]);
  });
});
