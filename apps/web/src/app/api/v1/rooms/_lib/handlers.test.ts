import { describe, expect, it, vi } from "vitest";
import { createRoomHandlers } from "./handlers.js";

const post = (path: string, body: unknown, cookie = "fp_session=session-token") => new Request(`https://example.test${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie = "fp_session=session-token") => new Request(`https://example.test${path}`, { headers: { cookie } });

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1", usernameCanonical: "alice", status: "ACTIVE" }) };
  const rooms = {
    create: vi.fn().mockResolvedValue({ id: "room-1", name: "决赛之夜", role: "room_owner", memberCount: 1, inviteToken: "invite-token", auditId: "audit-1" }),
    listRooms: vi.fn().mockResolvedValue([{ id: "room-1", name: "决赛之夜", role: "room_owner", memberCount: 1, status: "ACTIVE" }]),
    getRoom: vi.fn().mockResolvedValue({ id: "room-1", name: "决赛之夜", role: "room_owner", memberCount: 1, status: "ACTIVE" }),
    getBalance: vi.fn().mockResolvedValue({ availablePoints: "10000.00", frozenPoints: "0.00", correctionDebt: "0.00" }),
    getMembers: vi.fn().mockResolvedValue([{ userId: "user-1", username: "alice", role: "room_owner" }]),
    resetInvite: vi.fn().mockResolvedValue({ roomId: "room-1", inviteToken: "new-invite", auditId: "audit-2" }),
    previewInvite: vi.fn().mockResolvedValue({ id: "room-1", name: "决赛之夜" }),
    join: vi.fn().mockResolvedValue({ roomId: "room-1", joined: true }),
  };
  return { identity, rooms, handlers: createRoomHandlers(identity, rooms) };
}

describe("room HTTP handlers", () => {
  it("creates an owner room with current rules confirmation", async () => {
    const { handlers, rooms } = setup();
    const response = await handlers.create(post("/api/v1/rooms", { name: "决赛之夜", rulesAccepted: true }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { id: "room-1", inviteToken: "invite-token" } });
    expect(rooms.create).toHaveBeenCalledWith({ userId: "user-1", name: "决赛之夜", rulesAccepted: true });
  });

  it("lists only the authenticated user's rooms and isolated balance", async () => {
    const { handlers, rooms } = setup();
    await expect((await handlers.list(get("/api/v1/rooms"))).json()).resolves.toMatchObject({ data: [{ id: "room-1", role: "room_owner" }] });
    await expect((await handlers.balance(get("/api/v1/rooms/room-1/balance"), "room-1")).json()).resolves.toEqual({ data: { availablePoints: "10000.00", frozenPoints: "0.00", correctionDebt: "0.00" } });
    expect(rooms.getBalance).toHaveBeenCalledWith("room-1", "user-1");
  });

  it("previews an invite without identity but requires identity and rules to join", async () => {
    const { handlers, identity, rooms } = setup();
    await expect((await handlers.previewInvite(get("/api/v1/rooms/invites/invite-token", ""), "invite-token")).json()).resolves.toMatchObject({ data: { id: "room-1" } });
    expect(identity.authenticate).not.toHaveBeenCalled();
    const joined = await handlers.join(post("/api/v1/rooms/invites/invite-token", { rulesAccepted: true }), "invite-token");
    expect(joined.status).toBe(200);
    expect(rooms.join).toHaveBeenCalledWith({ userId: "user-1", inviteToken: "invite-token", rulesAccepted: true });
  });

  it("rejects protected operations without an active session", async () => {
    const { handlers, identity } = setup(); identity.authenticate.mockResolvedValueOnce(null);
    const response = await handlers.list(get("/api/v1/rooms", ""));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });
});
