import { describe, expect, it, vi } from "vitest";
import { RoomError } from "@pulse/domain";
import { createRoomGrantHandlers } from "./grants-handlers.js";

const ROOM = "00000000-0000-4000-8000-000000000009";
const GRANT = "00000000-0000-4000-8000-000000000001";

const post = (path: string, body: unknown, cookie = "fp_session=session-token") => new Request(`https://example.test${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie = "fp_session=session-token") => new Request(`https://example.test${path}`, { headers: { cookie } });

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const grants = {
    list: vi.fn().mockResolvedValue({ isOwner: false, requests: [] }),
    request: vi.fn().mockResolvedValue({ id: GRANT, status: "OPEN" }),
    decide: vi.fn().mockResolvedValue({ id: GRANT, status: "APPROVED", approvedAmount: "500.00" }),
  };
  return { identity, grants, handlers: createRoomGrantHandlers(identity, grants) };
}

describe("room grant HTTP handlers", () => {
  it("requires a session on every surface", async () => {
    const { handlers, identity, grants } = setup();
    identity.authenticate.mockResolvedValue(null);
    for (const response of [
      await handlers.list(get(`/api/v1/rooms/${ROOM}/grants`), ROOM),
      await handlers.request(post(`/api/v1/rooms/${ROOM}/grants`, {}), ROOM),
      await handlers.decide(post(`/api/v1/rooms/${ROOM}/grants/${GRANT}`, { action: "DENY" }), ROOM, GRANT),
    ]) expect(response.status).toBe(401);
    expect(grants.request).not.toHaveBeenCalled();
    expect(grants.decide).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before reading the body", async () => {
    const { handlers, grants } = setup();
    const crossOrigin = new Request(`https://example.test/api/v1/rooms/${ROOM}/grants`, {
      method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json", cookie: "fp_session=session-token" }, body: JSON.stringify({}),
    });
    const response = await handlers.request(crossOrigin, ROOM);
    expect(response.status).toBe(403);
    expect(grants.request).not.toHaveBeenCalled();
  });

  it("creates a request and returns 201", async () => {
    const { handlers, grants } = setup();
    const response = await handlers.request(post(`/api/v1/rooms/${ROOM}/grants`, { note: "需要补分" }), ROOM);
    expect(response.status).toBe(201);
    expect(grants.request).toHaveBeenCalledWith({ roomId: ROOM, userId: "user-1", note: "需要补分" });
  });

  it("answers malformed room and grant ids as 404, never a 500 or a different shape", async () => {
    const { handlers, grants } = setup();
    const badRoom = await handlers.list(get("/api/v1/rooms/not-a-uuid/grants"), "not-a-uuid");
    expect(badRoom.status).toBe(404);
    await expect(badRoom.json()).resolves.toMatchObject({ error: { code: "ROOM_NOT_FOUND" } });
    const badGrant = await handlers.decide(post(`/api/v1/rooms/${ROOM}/grants/xyz`, { action: "DENY" }), ROOM, "xyz");
    expect(badGrant.status).toBe(404);
    await expect(badGrant.json()).resolves.toMatchObject({ error: { code: "GRANT_NOT_FOUND" } });
    expect(grants.list).not.toHaveBeenCalled();
    expect(grants.decide).not.toHaveBeenCalled();
  });

  it("passes an approval through with its amount and refuses unknown shapes", async () => {
    const { handlers, grants } = setup();
    const approved = await handlers.decide(post(`/api/v1/rooms/${ROOM}/grants/${GRANT}`, { action: "APPROVE", amount: 500 }), ROOM, GRANT);
    expect(approved.status).toBe(200);
    expect(grants.decide).toHaveBeenCalledWith({ roomId: ROOM, grantId: GRANT, ownerId: "user-1", action: "APPROVE", amount: 500, note: null });

    for (const body of [
      { action: "APPROVE" }, // amount missing
      { action: "APPROVE", amount: "500" }, // stringly amount
      { action: "ESCALATE" }, // unknown action
      { action: "DENY", extra: true }, // .strict()
    ]) {
      const response = await handlers.decide(post(`/api/v1/rooms/${ROOM}/grants/${GRANT}`, body), ROOM, GRANT);
      expect(response.status).toBe(422);
    }
    expect(grants.decide).toHaveBeenCalledTimes(1);
  });

  it("maps domain refusals onto their contract codes", async () => {
    const { handlers, grants } = setup();
    grants.request.mockRejectedValue(new RoomError("GRANT_REQUEST_EXISTS", 409));
    const duplicate = await handlers.request(post(`/api/v1/rooms/${ROOM}/grants`, {}), ROOM);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: { code: "GRANT_REQUEST_EXISTS" } });

    grants.decide.mockRejectedValue(new RoomError("GRANT_ALREADY_DECIDED", 409));
    const conflict = await handlers.decide(post(`/api/v1/rooms/${ROOM}/grants/${GRANT}`, { action: "DENY" }), ROOM, GRANT);
    expect(conflict.status).toBe(409);

    grants.decide.mockRejectedValue(new RoomError("GRANT_NOT_FOUND", 404));
    const notOwner = await handlers.decide(post(`/api/v1/rooms/${ROOM}/grants/${GRANT}`, { action: "DENY" }), ROOM, GRANT);
    expect(notOwner.status).toBe(404);
  });

  it("never leaks internals on unexpected failures", async () => {
    const { handlers, grants } = setup();
    grants.list.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handlers.list(get(`/api/v1/rooms/${ROOM}/grants`), ROOM);
    spy.mockRestore();
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain("ECONNREFUSED");
    expect(payload).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});
