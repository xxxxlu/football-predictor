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
    listPublic: vi.fn().mockResolvedValue([{ id: "public-1", name: "公开看球局", ownerName: "alice", memberCount: 3, joined: false }]),
    joinPublic: vi.fn().mockResolvedValue({ roomId: "public-1", joined: true }),
  };
  return { identity, rooms, handlers: createRoomHandlers(identity, rooms) };
}

describe("room HTTP handlers", () => {
  it("creates an owner room with current rules confirmation", async () => {
    const { handlers, rooms } = setup();
    const response = await handlers.create(post("/api/v1/rooms", { name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { id: "room-1", inviteToken: "invite-token" } });
    expect(rooms.create).toHaveBeenCalledWith({ userId: "user-1", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true });
  });

  it("accepts a same-origin write validated against the browser Host header, not Next's request URL", async () => {
    // Regression: Next reports request.url on localhost even when the browser used 127.0.0.1,
    // which previously rejected every room create/join/invite reset with INVALID_ORIGIN.
    const { handlers, rooms } = setup();
    const request = new Request("http://localhost:3001/api/v1/rooms", {
      method: "POST",
      headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "content-type": "application/json", cookie: "fp_session=session-token" },
      body: JSON.stringify({ name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true }),
    });
    const response = await handlers.create(request);
    expect(response.status).toBe(201);
    expect(rooms.create).toHaveBeenCalledWith({ userId: "user-1", name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true });
  });

  it("rejects a genuinely cross-origin write with INVALID_ORIGIN", async () => {
    const { handlers, rooms } = setup();
    const request = new Request("https://app.example.com/api/v1/rooms", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://evil.example.com", "content-type": "application/json", cookie: "fp_session=session-token" },
      body: JSON.stringify({ name: "决赛之夜", visibility: "PRIVATE", rulesAccepted: true }),
    });
    const response = await handlers.create(request);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_ORIGIN" } });
    expect(rooms.create).not.toHaveBeenCalled();
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

  it("requires identity to list public rooms and same-origin rules confirmation to join", async () => {
    const { handlers, rooms } = setup();
    await expect((await handlers.listPublic(get("/api/v1/rooms/public"))).json()).resolves.toMatchObject({ data: [{ id: "public-1", joined: false }] });
    expect(rooms.listPublic).toHaveBeenCalledWith("user-1");
    const joined = await handlers.joinPublic(post("/api/v1/rooms/public-1/join", { rulesAccepted: true }), "public-1");
    expect(joined.status).toBe(200);
    expect(rooms.joinPublic).toHaveBeenCalledWith({ roomId: "public-1", userId: "user-1", rulesAccepted: true });
  });

  it("rejects protected operations without an active session", async () => {
    const { handlers, identity } = setup(); identity.authenticate.mockResolvedValueOnce(null);
    const response = await handlers.list(get("/api/v1/rooms", ""));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });
});
