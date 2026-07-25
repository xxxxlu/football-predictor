import { describe, expect, it } from "vitest";
import {
  buildInvitePath,
  createRoomRequest,
  inviteJoinRequest,
  normalizeRoomDetail,
  publicRoomJoinRequest,
} from "./room-flow.js";

describe("room frontend flow contracts", () => {
  it("submits room creation with an explicit current-rules confirmation and default standard tier", () => {
    expect(createRoomRequest("  周末看球局  ", "PUBLIC")).toEqual({
      url: "/api/v1/rooms",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "周末看球局", visibility: "PUBLIC", tier: "STANDARD", sport: "FOOTBALL", rulesAccepted: true }),
      },
    });
  });

  it("carries the advanced tier when creating a correct-score room", () => {
    expect(createRoomRequest("高级局", "PRIVATE", "ADVANCED").init.body)
      .toBe(JSON.stringify({ name: "高级局", visibility: "PRIVATE", tier: "ADVANCED", sport: "FOOTBALL", rulesAccepted: true }));
  });

  it("carries the F1 sport when creating an F1 room", () => {
    expect(createRoomRequest("车迷局", "PRIVATE", "STANDARD", "FORMULA_1").init.body)
      .toBe(JSON.stringify({ name: "车迷局", visibility: "PRIVATE", tier: "STANDARD", sport: "FORMULA_1", rulesAccepted: true }));
  });

  it("defaults missing sport to football and keeps an explicit F1 sport on the detail screen", () => {
    const base = {
      balance: { availablePoints: "10000.00", frozenPoints: "0.00", correctionDebt: "0.00" },
      members: [{ userId: "u1", username: "alice", role: "room_owner" as const }],
    };
    expect(normalizeRoomDetail({ ...base, room: { id: "room-1", name: "朋友局", visibility: "PRIVATE", role: "room_owner" } }).sport).toBe("FOOTBALL");
    expect(normalizeRoomDetail({ ...base, room: { id: "room-2", name: "车迷局", visibility: "PRIVATE", role: "room_owner", sport: "FORMULA_1" } }).sport).toBe("FORMULA_1");
  });

  it("joins a public room by id without an invitation credential", () => {
    expect(publicRoomJoinRequest("room/a")).toEqual({
      url: "/api/v1/rooms/room%2Fa/join",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ rulesAccepted: true }),
      },
    });
  });

  it("keeps raw invitation credentials out of query strings", () => {
    expect(buildInvitePath("a/b+c=")).toBe("/invite/a%2Fb%2Bc%3D");
    expect(inviteJoinRequest("a/b+c=")).toMatchObject({
      url: "/api/v1/rooms/invites/a%2Fb%2Bc%3D",
      init: { method: "POST", credentials: "same-origin" },
    });
  });

  it("normalizes room roles and balances for the detail screen", () => {
    expect(normalizeRoomDetail({
      room: { id: "room-1", name: "朋友局", status: "ACTIVE", visibility: "PUBLIC", role: "room_owner", memberCount: 2 },
      balance: { availablePoints: "10000.00", frozenPoints: "0.00", correctionDebt: "0.00" },
      members: [{ userId: "u1", username: "alice", role: "room_owner" }, { userId: "u2", username: "bob", role: "member" }],
    })).toMatchObject({
      id: "room-1",
      isOwner: true,
      visibility: "PUBLIC",
      tier: "STANDARD",
      preMatchStakeVisible: false,
      postMatchTicketVisible: true,
      balance: { availablePoints: "10000.00" },
      members: [{ displayName: "alice", roleLabel: "房主" }, { displayName: "bob", roleLabel: "成员" }],
    });
  });
});
