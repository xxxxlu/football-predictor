import { describe, expect, it } from "vitest";
import {
  buildInvitePath,
  createRoomRequest,
  inviteJoinRequest,
  normalizeRoomDetail,
  publicRoomJoinRequest,
} from "./room-flow.js";

describe("room frontend flow contracts", () => {
  it("submits room creation with an explicit current-rules confirmation", () => {
    expect(createRoomRequest("  周末看球局  ", "PUBLIC")).toEqual({
      url: "/api/v1/rooms",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "周末看球局", visibility: "PUBLIC", rulesAccepted: true }),
      },
    });
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
      preMatchStakeVisible: false,
      postMatchTicketVisible: true,
      balance: { availablePoints: "10000.00" },
      members: [{ displayName: "alice", roleLabel: "房主" }, { displayName: "bob", roleLabel: "成员" }],
    });
  });
});
