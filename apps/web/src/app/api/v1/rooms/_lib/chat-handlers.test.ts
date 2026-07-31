import { OperationError } from "@pulse/db";
import { describe, expect, it, vi } from "vitest";
import { createRoomChatHandlers } from "./chat-handlers.js";

const ROOM_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const MESSAGE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const MUTE_ID = "cccccccc-0000-4000-8000-000000000003";
const MEMBER_ID = "dddddddd-0000-4000-8000-000000000004";

const get = (path: string) => new Request(`https://example.test${path}`, { headers: { cookie: "fp_session=token" } });
const mutate = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: { cookie: "fp_session=token", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const chat = {
    listMessages: vi.fn().mockResolvedValue({ messages: [], pinned: null, cursor: null, mutedUntil: null, canPost: true, isOwner: false }),
    sendMessage: vi.fn().mockResolvedValue({ id: MESSAGE_ID, body: "你好" }),
    pinMessage: vi.fn().mockResolvedValue({ pinned: true, messageId: MESSAGE_ID }),
    unpinMessage: vi.fn().mockResolvedValue({ pinned: false }),
    muteMember: vi.fn().mockResolvedValue({ muteId: MUTE_ID, mutedUntil: "2026-08-01T12:00:00.000Z" }),
    unmuteMember: vi.fn().mockResolvedValue({ lifted: true }),
  };
  const reports = { reportMessage: vi.fn().mockResolvedValue({ reportId: "report-1", status: "OPEN" }) };
  return { identity, chat, reports, handlers: createRoomChatHandlers(identity, chat, reports) };
}

describe("room chat API authentication", () => {
  it("refuses every route without a session before touching the repository", async () => {
    const subject = setup();
    subject.identity.authenticate.mockResolvedValue(null);
    const responses = await Promise.all([
      subject.handlers.list(get(`/api/v1/rooms/${ROOM_ID}/messages`), ROOM_ID),
      subject.handlers.send(mutate(`/api/v1/rooms/${ROOM_ID}/messages`, "POST", { body: "你好" }), ROOM_ID),
      subject.handlers.pin(mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/pin`, "POST"), ROOM_ID, MESSAGE_ID),
      subject.handlers.unpin(mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/pin`, "DELETE"), ROOM_ID),
      subject.handlers.mute(mutate(`/api/v1/rooms/${ROOM_ID}/mutes`, "POST", { memberUserId: MEMBER_ID, muteHours: 24, reason: "连续刷屏广告" }), ROOM_ID),
      subject.handlers.unmute(mutate(`/api/v1/rooms/${ROOM_ID}/mutes/${MUTE_ID}`, "DELETE", { reason: "误禁，解除" }), ROOM_ID, MUTE_ID),
      subject.handlers.report(mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/reports`, "POST", { reason: "人身攻击，需要尽快处理" }), ROOM_ID, MESSAGE_ID),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    for (const call of Object.values(subject.chat)) expect(call).not.toHaveBeenCalled();
    expect(subject.reports.reportMessage).not.toHaveBeenCalled();
  });

  it("refuses cross-origin mutations before authentication runs", async () => {
    const subject = setup();
    const response = await subject.handlers.send(
      mutate(`/api/v1/rooms/${ROOM_ID}/messages`, "POST", { body: "你好" }, { origin: "https://evil.test" }), ROOM_ID,
    );
    expect(response.status).toBe(403);
    expect(subject.identity.authenticate).not.toHaveBeenCalled();
    expect(subject.chat.sendMessage).not.toHaveBeenCalled();
  });
});

describe("reading the chat", () => {
  it("returns the page under data and the keyset cursor under meta", async () => {
    const subject = setup();
    subject.chat.listMessages.mockResolvedValue({ messages: [{ id: MESSAGE_ID }], pinned: null, cursor: "next-cursor", mutedUntil: null, canPost: true, isOwner: false });
    const response = await subject.handlers.list(get(`/api/v1/rooms/${ROOM_ID}/messages?cursor=abc`), ROOM_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { messages: [{ id: MESSAGE_ID }], pinned: null, mutedUntil: null, canPost: true, isOwner: false },
      meta: { cursor: "next-cursor" },
    });
    expect(subject.chat.listMessages).toHaveBeenCalledWith(ROOM_ID, "user-1", { cursor: "abc" });
  });

  it("answers a malformed room id exactly like a missing room", async () => {
    const subject = setup();
    const response = await subject.handlers.list(get("/api/v1/rooms/not-a-uuid/messages"), "not-a-uuid");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("ROOM_NOT_FOUND");
    expect(subject.chat.listMessages).not.toHaveBeenCalled();
  });
});

describe("sending a message", () => {
  it("trims the body server-side and creates the message", async () => {
    const subject = setup();
    const response = await subject.handlers.send(mutate(`/api/v1/rooms/${ROOM_ID}/messages`, "POST", { body: "  今晚谁赢？  " }), ROOM_ID);
    expect(response.status).toBe(201);
    expect(subject.chat.sendMessage).toHaveBeenCalledWith(ROOM_ID, "user-1", "今晚谁赢？");
  });

  it("refuses an empty or over-long body without touching storage", async () => {
    const subject = setup();
    for (const body of [{ body: "   " }, { body: "" }, { body: "长".repeat(501) }, { body: "你好", extra: 1 }, {}]) {
      expect((await subject.handlers.send(mutate(`/api/v1/rooms/${ROOM_ID}/messages`, "POST", body), ROOM_ID)).status).toBe(422);
    }
    expect(subject.chat.sendMessage).not.toHaveBeenCalled();
  });

  it("passes the repository's refusals through with their own status", async () => {
    const subject = setup();
    for (const [code, status] of [["MUTED", 403], ["RATE_LIMITED", 429], ["DUPLICATE_MESSAGE", 422], ["ROOM_NOT_ACTIVE", 409], ["ROOM_NOT_FOUND", 404]] as const) {
      subject.chat.sendMessage.mockRejectedValueOnce(new OperationError(code, status));
      const response = await subject.handlers.send(mutate(`/api/v1/rooms/${ROOM_ID}/messages`, "POST", { body: "你好" }), ROOM_ID);
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });
});

describe("owner actions", () => {
  it("pins and unpins through the owner surface", async () => {
    const subject = setup();
    const pin = await subject.handlers.pin(mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/pin`, "POST"), ROOM_ID, MESSAGE_ID);
    expect(pin.status).toBe(200);
    expect(subject.chat.pinMessage).toHaveBeenCalledWith(ROOM_ID, "user-1", MESSAGE_ID);
    const unpin = await subject.handlers.unpin(mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/pin`, "DELETE"), ROOM_ID);
    expect(unpin.status).toBe(200);
    expect(subject.chat.unpinMessage).toHaveBeenCalledWith(ROOM_ID, "user-1");
  });

  it("mutes only with a listed duration and a written reason", async () => {
    const subject = setup();
    const response = await subject.handlers.mute(mutate(`/api/v1/rooms/${ROOM_ID}/mutes`, "POST", { memberUserId: MEMBER_ID, muteHours: 72, reason: "连续刷屏广告" }), ROOM_ID);
    expect(response.status).toBe(201);
    expect(subject.chat.muteMember).toHaveBeenCalledWith(ROOM_ID, "user-1", { memberUserId: MEMBER_ID, muteHours: 72, reason: "连续刷屏广告" });
    for (const body of [
      { memberUserId: MEMBER_ID, muteHours: 5, reason: "连续刷屏广告" },
      { memberUserId: MEMBER_ID, muteHours: 24, reason: "短" },
      { memberUserId: "not-a-uuid", muteHours: 24, reason: "连续刷屏广告" },
      { memberUserId: MEMBER_ID, muteHours: 24 },
    ]) {
      expect((await subject.handlers.mute(mutate(`/api/v1/rooms/${ROOM_ID}/mutes`, "POST", body), ROOM_ID)).status).toBe(422);
    }
    expect(subject.chat.muteMember).toHaveBeenCalledTimes(1);
  });

  it("unmutes with a reason, and treats a malformed mute id as nothing to lift", async () => {
    const subject = setup();
    const response = await subject.handlers.unmute(mutate(`/api/v1/rooms/${ROOM_ID}/mutes/${MUTE_ID}`, "DELETE", { reason: "误禁，解除" }), ROOM_ID, MUTE_ID);
    expect(response.status).toBe(200);
    expect(subject.chat.unmuteMember).toHaveBeenCalledWith(ROOM_ID, "user-1", MUTE_ID, "误禁，解除");
    const malformed = await subject.handlers.unmute(mutate(`/api/v1/rooms/${ROOM_ID}/mutes/xyz`, "DELETE", { reason: "误禁，解除" }), ROOM_ID, "xyz");
    expect(malformed.status).toBe(409);
    expect((await malformed.json()).error.code).toBe("MUTE_NOT_ACTIVE");
    expect(subject.chat.unmuteMember).toHaveBeenCalledTimes(1);
  });
});

describe("reporting a message", () => {
  it("files through the governance inbox with the caller as reporter — and nothing else", async () => {
    const subject = setup();
    const response = await subject.handlers.report(mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/reports`, "POST", { reason: "人身攻击，需要尽快处理" }), ROOM_ID, MESSAGE_ID);
    expect(response.status).toBe(201);
    // The route offers no field for subject, excerpt or sent-at — the inbox
    // derives them from the message row (deferred-work gap ①).
    expect(subject.reports.reportMessage).toHaveBeenCalledWith({ messageId: MESSAGE_ID, roomId: ROOM_ID, reporterUserId: "user-1", reason: "人身攻击，需要尽快处理" });
  });

  it("refuses a fabricated evidence payload as an unknown field", async () => {
    const subject = setup();
    const response = await subject.handlers.report(
      mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/reports`, "POST", { reason: "人身攻击，需要尽快处理", excerpt: "编造的话" }), ROOM_ID, MESSAGE_ID);
    expect(response.status).toBe(422);
    expect(subject.reports.reportMessage).not.toHaveBeenCalled();
  });

  it("names a self-report and a duplicate filing", async () => {
    const subject = setup();
    for (const [code, status] of [["SELF_REPORT_FORBIDDEN", 422], ["REPORT_ALREADY_OPEN", 409]] as const) {
      subject.reports.reportMessage.mockRejectedValueOnce(new OperationError(code, status));
      const response = await subject.handlers.report(
        mutate(`/api/v1/rooms/${ROOM_ID}/messages/${MESSAGE_ID}/reports`, "POST", { reason: "人身攻击，需要尽快处理" }), ROOM_ID, MESSAGE_ID);
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });
});
