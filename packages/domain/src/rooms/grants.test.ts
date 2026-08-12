import { describe, expect, it } from "vitest";
import {
  GRANT_MAX_POINTS,
  GRANT_NOTE_MAX_CODEPOINTS,
  grantRoomStatusRefusal,
  normalizeGrantAmount,
  normalizeGrantNote,
  RoomGrantService,
  ruleOnGrantDecision,
  type GrantDecisionAction,
  type GrantRequestRecord,
  type GrantRequestStatus,
  type RoomGrantRepository,
} from "../index.js";
import { RoomError } from "./service.js";

function code(run: () => unknown): string {
  try { run(); } catch (error) { if (error instanceof RoomError) return error.code; throw error; }
  return "NO_ERROR";
}

describe("normalizeGrantAmount", () => {
  it("accepts whole points across the full range and emits ledger form", () => {
    expect(normalizeGrantAmount(1)).toBe("1.00");
    expect(normalizeGrantAmount(2500)).toBe("2500.00");
    expect(normalizeGrantAmount(GRANT_MAX_POINTS)).toBe("20000.00");
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["above ceiling", GRANT_MAX_POINTS + 1],
    ["fractional", 100.5],
    ["NaN", Number.NaN],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("refuses %s with GRANT_AMOUNT_INVALID", (_label, amount) => {
    expect(code(() => normalizeGrantAmount(amount))).toBe("GRANT_AMOUNT_INVALID");
  });
});

describe("normalizeGrantNote", () => {
  it("passes through absent and blank notes as null", () => {
    expect(normalizeGrantNote(undefined)).toBeNull();
    expect(normalizeGrantNote(null)).toBeNull();
    expect(normalizeGrantNote("   ")).toBeNull();
  });

  it("trims and keeps a note at the code-point boundary", () => {
    expect(normalizeGrantNote("  周末补给  ")).toBe("周末补给");
    // 200 emoji are 200 code points (400 UTF-16 units): the limit counts what
    // char_length counts, so this must pass, not 422 (story 12.2 lesson).
    const emoji = "🎯".repeat(GRANT_NOTE_MAX_CODEPOINTS);
    expect(normalizeGrantNote(emoji)).toBe(emoji);
  });

  it("refuses one code point over the limit", () => {
    expect(code(() => normalizeGrantNote("🎯".repeat(GRANT_NOTE_MAX_CODEPOINTS + 1)))).toBe("GRANT_NOTE_TOO_LONG");
  });
});

describe("grantRoomStatusRefusal", () => {
  it("allows ACTIVE and refuses RESTRICTED/CLOSED with ROOM_NOT_ACTIVE", () => {
    expect(grantRoomStatusRefusal("ACTIVE")).toBeNull();
    expect(grantRoomStatusRefusal("RESTRICTED")?.code).toBe("ROOM_NOT_ACTIVE");
    expect(grantRoomStatusRefusal("CLOSED")?.code).toBe("ROOM_NOT_ACTIVE");
  });
});

describe("ruleOnGrantDecision — full transition table", () => {
  const rule = (status: GrantRequestStatus, approvedAmount: string | null, action: GrantDecisionAction, amount: string | null) =>
    ruleOnGrantDecision({ current: { status, approvedAmount }, action, amount });

  it("proceeds from OPEN for both actions", () => {
    expect(rule("OPEN", null, "APPROVE", "500.00")).toEqual({ kind: "PROCEED" });
    expect(rule("OPEN", null, "DENY", null)).toEqual({ kind: "PROCEED" });
  });

  it("replays an identical repeated outcome", () => {
    expect(rule("APPROVED", "500.00", "APPROVE", "500.00")).toEqual({ kind: "REPLAY" });
    expect(rule("DENIED", null, "DENY", null)).toEqual({ kind: "REPLAY" });
  });

  it("refuses conflicting decisions with GRANT_ALREADY_DECIDED", () => {
    const cases: Array<[GrantRequestStatus, string | null, GrantDecisionAction, string | null]> = [
      ["APPROVED", "500.00", "APPROVE", "800.00"], // different amount is a new decision, not a replay
      ["APPROVED", "500.00", "DENY", null],
      ["DENIED", null, "APPROVE", "500.00"],
    ];
    for (const [status, approvedAmount, action, amount] of cases) {
      const ruling = rule(status, approvedAmount, action, amount);
      expect(ruling.kind).toBe("REFUSE");
      if (ruling.kind === "REFUSE") {
        expect(ruling.error.code).toBe("GRANT_ALREADY_DECIDED");
        expect(ruling.error.status).toBe(409);
      }
    }
  });
});

class MemoryGrantRepository implements RoomGrantRepository {
  requests = new Map<string, GrantRequestRecord & { created: boolean }>();
  memberOf = new Set<string>();
  ownerOf = new Set<string>();
  lastDecide: Parameters<RoomGrantRepository["decideGrant"]>[0] | undefined;

  async requestGrant(input: Parameters<RoomGrantRepository["requestGrant"]>[0]) {
    if (!this.memberOf.has(`${input.roomId}:${input.requesterUserId}`)) return null;
    const existing = [...this.requests.values()].find((row) => row.roomId === input.roomId && row.requester.userId === input.requesterUserId && row.status === "OPEN");
    if (existing) return { request: existing, created: false };
    const request: GrantRequestRecord = {
      id: input.id, roomId: input.roomId,
      requester: { userId: input.requesterUserId, displayName: input.requesterUserId },
      note: input.note, status: "OPEN", requestedAt: input.now.toISOString(),
      decidedAt: null, approvedAmount: null, decisionNote: null,
    };
    this.requests.set(input.id, { ...request, created: true });
    return { request, created: true };
  }

  async decideGrant(input: Parameters<RoomGrantRepository["decideGrant"]>[0]) {
    this.lastDecide = input;
    if (!this.ownerOf.has(`${input.roomId}:${input.ownerId}`)) return null;
    const row = this.requests.get(input.grantId);
    if (!row || row.roomId !== input.roomId) return null;
    const ruling = ruleOnGrantDecision({ current: { status: row.status, approvedAmount: row.approvedAmount }, action: input.action, amount: input.amount });
    if (ruling.kind === "REFUSE") throw ruling.error;
    if (ruling.kind === "REPLAY") return { request: row, replayed: true };
    const decided: GrantRequestRecord = {
      ...row,
      status: input.action === "APPROVE" ? "APPROVED" : "DENIED",
      decidedAt: input.now.toISOString(),
      approvedAmount: input.amount,
      decisionNote: input.note,
    };
    this.requests.set(row.id, { ...decided, created: false });
    return { request: decided, replayed: false };
  }

  async listGrants(roomId: string, viewerUserId: string) {
    if (!this.memberOf.has(`${roomId}:${viewerUserId}`)) return null;
    const isOwner = this.ownerOf.has(`${roomId}:${viewerUserId}`);
    const requests = [...this.requests.values()].filter((row) => row.roomId === roomId
      && (isOwner || row.status === "APPROVED" || row.requester.userId === viewerUserId));
    return { isOwner, requests };
  }
}

function service(repository: MemoryGrantRepository) {
  let sequence = 0;
  return new RoomGrantService(repository, { id: () => `id-${++sequence}` }, () => new Date("2026-08-12T10:00:00Z"));
}

describe("RoomGrantService", () => {
  it("creates a request and refuses a second one while the first is OPEN", async () => {
    const repository = new MemoryGrantRepository();
    repository.memberOf.add("room-1:alice");
    const grants = service(repository);
    const request = await grants.request({ roomId: "room-1", userId: "alice", note: " 需要补分 " });
    expect(request.status).toBe("OPEN");
    expect(request.note).toBe("需要补分");
    await expect(grants.request({ roomId: "room-1", userId: "alice" })).rejects.toMatchObject({ code: "GRANT_REQUEST_EXISTS", status: 409 });
  });

  it("answers 404 same-shape for non-members", async () => {
    const repository = new MemoryGrantRepository();
    const grants = service(repository);
    await expect(grants.request({ roomId: "room-1", userId: "mallory" })).rejects.toMatchObject({ code: "ROOM_NOT_FOUND", status: 404 });
    await expect(grants.list("room-1", "mallory")).rejects.toMatchObject({ code: "ROOM_NOT_FOUND", status: 404 });
  });

  it("normalizes the approved amount to ledger form before the repository sees it", async () => {
    const repository = new MemoryGrantRepository();
    repository.memberOf.add("room-1:alice");
    repository.ownerOf.add("room-1:owner");
    const grants = service(repository);
    const request = await grants.request({ roomId: "room-1", userId: "alice" });
    const decided = await grants.decide({ roomId: "room-1", grantId: request.id, ownerId: "owner", action: "APPROVE", amount: 2500 });
    expect(decided.status).toBe("APPROVED");
    expect(decided.approvedAmount).toBe("2500.00");
    expect(repository.lastDecide?.amount).toBe("2500.00");
  });

  it("refuses APPROVE without a valid amount before touching the repository", async () => {
    const repository = new MemoryGrantRepository();
    const grants = service(repository);
    await expect(grants.decide({ roomId: "room-1", grantId: "g", ownerId: "owner", action: "APPROVE" })).rejects.toMatchObject({ code: "GRANT_AMOUNT_INVALID" });
    expect(repository.lastDecide).toBeUndefined();
  });

  it("answers GRANT_NOT_FOUND 404 for a non-owner decider (same shape as missing)", async () => {
    const repository = new MemoryGrantRepository();
    repository.memberOf.add("room-1:alice");
    const grants = service(repository);
    const request = await grants.request({ roomId: "room-1", userId: "alice" });
    await expect(grants.decide({ roomId: "room-1", grantId: request.id, ownerId: "alice", action: "DENY" })).rejects.toMatchObject({ code: "GRANT_NOT_FOUND", status: 404 });
  });

  it("denies without an amount and keeps history intact", async () => {
    const repository = new MemoryGrantRepository();
    repository.memberOf.add("room-1:alice");
    repository.ownerOf.add("room-1:owner");
    const grants = service(repository);
    const request = await grants.request({ roomId: "room-1", userId: "alice" });
    const denied = await grants.decide({ roomId: "room-1", grantId: request.id, ownerId: "owner", action: "DENY", note: "本轮先不补" });
    expect(denied.status).toBe("DENIED");
    expect(denied.approvedAmount).toBeNull();
    expect(denied.decisionNote).toBe("本轮先不补");
  });

  it("hides other members' pending and denied requests from a non-owner list", async () => {
    const repository = new MemoryGrantRepository();
    repository.memberOf.add("room-1:alice");
    repository.memberOf.add("room-1:bob");
    repository.ownerOf.add("room-1:owner");
    repository.memberOf.add("room-1:owner");
    const grants = service(repository);
    const fromAlice = await grants.request({ roomId: "room-1", userId: "alice" });
    await grants.request({ roomId: "room-1", userId: "bob" });
    await grants.decide({ roomId: "room-1", grantId: fromAlice.id, ownerId: "owner", action: "APPROVE", amount: 1000 });
    const forBob = await grants.list("room-1", "bob");
    expect(forBob.isOwner).toBe(false);
    expect(forBob.requests.map((row) => `${row.requester.userId}:${row.status}`).sort()).toEqual(["alice:APPROVED", "bob:OPEN"]);
    const forOwner = await grants.list("room-1", "owner");
    expect(forOwner.isOwner).toBe(true);
    expect(forOwner.requests).toHaveLength(2);
  });
});
