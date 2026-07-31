import { OperationError } from "@pulse/db";
import { describe, expect, it, vi } from "vitest";
import { createSocialHandlers } from "./social-handlers.js";

const REQUEST_ID = "cccccccc-0000-0000-0000-000000000003";
const OTHER_USER = "bbbbbbbb-0000-0000-0000-000000000002";

const get = (path: string) => new Request(`https://example.test${path}`, { headers: { cookie: "fp_session=token" } });
const mutate = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: { cookie: "fp_session=token", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const social = {
    requestFriend: vi.fn().mockResolvedValue({ status: "PENDING" }),
    respondToFriendRequest: vi.fn().mockResolvedValue({ status: "ACCEPTED" }),
    removeFriend: vi.fn().mockResolvedValue({ removed: true }),
    listFriends: vi.fn().mockResolvedValue([]),
    listFriendRequests: vi.fn().mockResolvedValue([]),
    blockUser: vi.fn().mockResolvedValue({ blocked: true }),
    unblockUser: vi.fn().mockResolvedValue({ unblocked: true }),
    listBlocks: vi.fn().mockResolvedValue([]),
    getPrivacyPreferences: vi.fn().mockResolvedValue({ showOnlineToFriends: false, showLobbyToFriends: false }),
    updatePrivacyPreferences: vi.fn().mockResolvedValue({ showOnlineToFriends: true, showLobbyToFriends: false }),
    recordHeartbeat: vi.fn().mockResolvedValue({ recorded: false }),
  };
  return { identity, social, handlers: createSocialHandlers(identity, social) };
}

describe("social API authentication", () => {
  it("refuses every route without a session before touching the repository", async () => {
    const subject = setup();
    subject.identity.authenticate.mockResolvedValue(null);
    const responses = await Promise.all([
      subject.handlers.friendsList(get("/api/v1/friends")),
      subject.handlers.requestsList(get("/api/v1/friends/requests")),
      subject.handlers.requestCreate(mutate("/api/v1/friends/requests", "POST", { pulseId: "bob" })),
      subject.handlers.requestRespond(mutate(`/api/v1/friends/requests/${REQUEST_ID}`, "POST", { action: "accept" }), REQUEST_ID),
      subject.handlers.friendRemove(mutate(`/api/v1/friends/${OTHER_USER}`, "DELETE"), OTHER_USER),
      subject.handlers.blocksList(get("/api/v1/blocks")),
      subject.handlers.blockCreate(mutate("/api/v1/blocks", "POST", { pulseId: "bob" })),
      subject.handlers.blockRemove(mutate(`/api/v1/blocks/${OTHER_USER}`, "DELETE"), OTHER_USER),
      subject.handlers.privacyGet(get("/api/v1/account/privacy")),
      subject.handlers.privacyPatch(mutate("/api/v1/account/privacy", "PATCH", { showOnlineToFriends: true })),
      subject.handlers.heartbeat(mutate("/api/v1/presence/heartbeat", "POST")),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    for (const call of Object.values(subject.social)) expect(call).not.toHaveBeenCalled();
  });

  it("refuses cross-origin mutations before authentication runs", async () => {
    const subject = setup();
    const response = await subject.handlers.requestCreate(
      mutate("/api/v1/friends/requests", "POST", { pulseId: "bob" }, { origin: "https://evil.test" }),
    );
    expect(response.status).toBe(403);
    expect(subject.identity.authenticate).not.toHaveBeenCalled();
    expect(subject.social.requestFriend).not.toHaveBeenCalled();
  });
});

describe("friend requests", () => {
  it("normalizes the PULSE ID and scopes the call to the authenticated user", async () => {
    const subject = setup();
    const response = await subject.handlers.requestCreate(mutate("/api/v1/friends/requests", "POST", { pulseId: "  Bob_01 " }));
    expect(response.status).toBe(200);
    expect(subject.social.requestFriend).toHaveBeenCalledWith("user-1", "bob_01");
    expect(await response.json()).toEqual({ data: { status: "PENDING" } });
  });

  it("rejects malformed PULSE IDs and unknown fields without touching storage", async () => {
    const subject = setup();
    for (const body of [{ pulseId: "ab" }, { pulseId: "has space" }, { pulseId: "bob", extra: 1 }, {}]) {
      expect((await subject.handlers.requestCreate(mutate("/api/v1/friends/requests", "POST", body))).status).toBe(422);
    }
    expect(subject.social.requestFriend).not.toHaveBeenCalled();
  });

  it("passes rate limiting through as 429", async () => {
    const subject = setup();
    subject.social.requestFriend.mockRejectedValueOnce(new OperationError("RATE_LIMITED", 429));
    const response = await subject.handlers.requestCreate(mutate("/api/v1/friends/requests", "POST", { pulseId: "bob" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
  });

  it("answers a malformed request id exactly like a foreign one (404, same shape)", async () => {
    const subject = setup();
    const malformed = await subject.handlers.requestRespond(
      mutate("/api/v1/friends/requests/not-a-uuid", "POST", { action: "accept" }),
      "not-a-uuid",
    );
    subject.social.respondToFriendRequest.mockRejectedValueOnce(new OperationError("REQUEST_NOT_FOUND", 404));
    const foreign = await subject.handlers.requestRespond(
      mutate(`/api/v1/friends/requests/${REQUEST_ID}`, "POST", { action: "accept" }),
      REQUEST_ID,
    );
    expect(malformed.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(await malformed.json()).toEqual(await foreign.json());
    expect(subject.social.respondToFriendRequest).toHaveBeenCalledTimes(1);
  });

  it("accepts only the two respond actions", async () => {
    const subject = setup();
    expect(
      (await subject.handlers.requestRespond(mutate(`/x/${REQUEST_ID}`, "POST", { action: "block" }), REQUEST_ID)).status,
    ).toBe(422);
    expect(
      (await subject.handlers.requestRespond(mutate(`/x/${REQUEST_ID}`, "POST", { action: "decline" }), REQUEST_ID)).status,
    ).toBe(200);
    expect(subject.social.respondToFriendRequest).toHaveBeenCalledWith("user-1", REQUEST_ID, "decline");
  });
});

describe("friends and blocks", () => {
  it("treats a malformed or self target as nothing-to-remove without a query", async () => {
    const subject = setup();
    for (const target of ["not-a-uuid", "user-1"]) {
      const response = await subject.handlers.friendRemove(mutate(`/api/v1/friends/${target}`, "DELETE"), target);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { removed: false } });
    }
    expect(subject.social.removeFriend).not.toHaveBeenCalled();
    const real = await subject.handlers.friendRemove(mutate(`/api/v1/friends/${OTHER_USER}`, "DELETE"), OTHER_USER);
    expect(real.status).toBe(200);
    expect(subject.social.removeFriend).toHaveBeenCalledWith("user-1", OTHER_USER);
  });

  it("blocks by PULSE ID and unblocks by user id, both scoped to the caller", async () => {
    const subject = setup();
    expect((await subject.handlers.blockCreate(mutate("/api/v1/blocks", "POST", { pulseId: "bob" }))).status).toBe(200);
    expect(subject.social.blockUser).toHaveBeenCalledWith("user-1", "bob");
    expect((await subject.handlers.blockRemove(mutate(`/api/v1/blocks/${OTHER_USER}`, "DELETE"), OTHER_USER)).status).toBe(200);
    expect(subject.social.unblockUser).toHaveBeenCalledWith("user-1", OTHER_USER);
  });
});

describe("privacy and presence", () => {
  it("requires at least one known toggle and rejects unknown fields", async () => {
    const subject = setup();
    for (const body of [{}, { unknown: true }, { showOnlineToFriends: "yes" }]) {
      expect((await subject.handlers.privacyPatch(mutate("/api/v1/account/privacy", "PATCH", body))).status).toBe(422);
    }
    expect(subject.social.updatePrivacyPreferences).not.toHaveBeenCalled();
    const response = await subject.handlers.privacyPatch(mutate("/api/v1/account/privacy", "PATCH", { showOnlineToFriends: true }));
    expect(response.status).toBe(200);
    expect(subject.social.updatePrivacyPreferences).toHaveBeenCalledWith("user-1", { showOnlineToFriends: true });
  });

  it("reports the server-side heartbeat gate outcome instead of trusting the client", async () => {
    const subject = setup();
    const response = await subject.handlers.heartbeat(mutate("/api/v1/presence/heartbeat", "POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { recorded: false } });
    expect(subject.social.recordHeartbeat).toHaveBeenCalledWith("user-1");
  });
});
