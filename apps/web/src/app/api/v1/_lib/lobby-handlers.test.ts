import { OperationError } from "@pulse/db";
import { describe, expect, it, vi } from "vitest";
import { createLobbyHandlers } from "./lobby-handlers.js";

const MESSAGE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const NOW = () => new Date("2026-07-31T12:00:00.000Z");

const get = (path: string) => new Request(`https://example.test${path}`, { headers: { cookie: "fp_session=token" } });
const mutate = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: { cookie: "fp_session=token", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const channel = {
    listMessages: vi.fn().mockResolvedValue({ messages: [], cursor: null, mutedUntil: null, rulesConfirmed: true }),
    sendMessage: vi.fn().mockResolvedValue({ id: MESSAGE_ID, body: "你好" }),
    lobbyDirectory: vi.fn().mockResolvedValue([{ pulseId: "lucy", nickname: null }]),
    friendActivity: vi.fn().mockResolvedValue({ viewerAnswered: false, friends: [] }),
    getCommunityRulesStatus: vi.fn().mockResolvedValue({ version: "community:v1", confirmed: false }),
    acceptCommunityRules: vi.fn().mockResolvedValue({ version: "community:v1", confirmed: true }),
  };
  const reports = { reportChannelMessage: vi.fn().mockResolvedValue({ reportId: "report-1", status: "OPEN" }) };
  return { identity, channel, reports, handlers: createLobbyHandlers(identity, channel, reports, NOW) };
}

describe("club lobby API authentication", () => {
  it("refuses every route without a session before touching the repository", async () => {
    const subject = setup();
    subject.identity.authenticate.mockResolvedValue(null);
    const responses = await Promise.all([
      subject.handlers.lobby(get("/api/v1/club/lobby")),
      subject.handlers.messagesList(get("/api/v1/club/channel/messages")),
      subject.handlers.messagesSend(mutate("/api/v1/club/channel/messages", "POST", { body: "你好" })),
      subject.handlers.messageReport(mutate(`/api/v1/club/channel/messages/${MESSAGE_ID}/reports`, "POST", { reason: "违规导流拉人，需要处理" }), MESSAGE_ID),
      subject.handlers.rulesGet(get("/api/v1/club/rules-acceptance")),
      subject.handlers.rulesAccept(mutate("/api/v1/club/rules-acceptance", "POST")),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    for (const call of Object.values(subject.channel)) expect(call).not.toHaveBeenCalled();
    expect(subject.reports.reportChannelMessage).not.toHaveBeenCalled();
  });

  it("refuses cross-origin mutations before authentication runs", async () => {
    const subject = setup();
    for (const attempt of [
      subject.handlers.messagesSend(mutate("/api/v1/club/channel/messages", "POST", { body: "你好" }, { origin: "https://evil.test" })),
      subject.handlers.rulesAccept(mutate("/api/v1/club/rules-acceptance", "POST", undefined, { origin: "https://evil.test" })),
    ]) {
      expect((await attempt).status).toBe(403);
    }
    expect(subject.identity.authenticate).not.toHaveBeenCalled();
  });
});

describe("the lobby aggregate", () => {
  it("returns every section with the server's product day", async () => {
    const subject = setup();
    const response = await subject.handlers.lobby(get("/api/v1/club/lobby"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: {
        day: "2026-07-31",
        directory: [{ pulseId: "lucy", nickname: null }],
        friends: { viewerAnswered: false, friends: [] },
        channel: { messages: [], cursor: null, mutedUntil: null, rulesConfirmed: true },
        failedSections: [],
      },
    });
    expect(subject.channel.friendActivity).toHaveBeenCalledWith("user-1", "2026-07-31");
  });

  it("degrades a failed section to null and names it, without taking the page down", async () => {
    const subject = setup();
    subject.channel.lobbyDirectory.mockRejectedValue(new Error("directory query died"));
    const response = await subject.handlers.lobby(get("/api/v1/club/lobby"));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.directory).toBeNull();
    expect(data.failedSections).toEqual(["directory"]);
    expect(data.channel).not.toBeNull();
  });
});

describe("reading the channel", () => {
  it("returns the page under data and the keyset cursor under meta", async () => {
    const subject = setup();
    subject.channel.listMessages.mockResolvedValue({ messages: [{ id: MESSAGE_ID }], cursor: "next-cursor", mutedUntil: null, rulesConfirmed: false });
    const response = await subject.handlers.messagesList(get("/api/v1/club/channel/messages?cursor=abc"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { messages: [{ id: MESSAGE_ID }], mutedUntil: null, rulesConfirmed: false },
      meta: { cursor: "next-cursor" },
    });
    expect(subject.channel.listMessages).toHaveBeenCalledWith("user-1", { cursor: "abc" });
  });
});

describe("sending to the channel", () => {
  it("trims the body server-side and creates the message", async () => {
    const subject = setup();
    const response = await subject.handlers.messagesSend(mutate("/api/v1/club/channel/messages", "POST", { body: "  今晚谁夺冠？  " }));
    expect(response.status).toBe(201);
    expect(subject.channel.sendMessage).toHaveBeenCalledWith("user-1", "今晚谁夺冠？");
  });

  it("refuses an empty or over-long body without touching storage", async () => {
    const subject = setup();
    for (const body of [{ body: "   " }, { body: "" }, { body: "长".repeat(501) }, { body: "你好", extra: 1 }, {}]) {
      expect((await subject.handlers.messagesSend(mutate("/api/v1/club/channel/messages", "POST", body))).status).toBe(422);
    }
    expect(subject.channel.sendMessage).not.toHaveBeenCalled();
  });

  it("passes each AC2 refusal through with its stable code and recovery-shaped message", async () => {
    const subject = setup();
    for (const [code, status] of [
      ["RULES_CONFIRMATION_REQUIRED", 403],
      ["COMMUNITY_MUTED", 403],
      ["RATE_LIMITED", 429],
      ["DUPLICATE_MESSAGE", 422],
    ] as const) {
      subject.channel.sendMessage.mockRejectedValueOnce(new OperationError(code, status));
      const response = await subject.handlers.messagesSend(mutate("/api/v1/club/channel/messages", "POST", { body: "你好" }));
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });
});

describe("reporting a channel message", () => {
  it("files through the governance inbox with the caller as reporter — and nothing else", async () => {
    const subject = setup();
    const response = await subject.handlers.messageReport(
      mutate(`/api/v1/club/channel/messages/${MESSAGE_ID}/reports`, "POST", { reason: "违规导流拉人，需要处理" }), MESSAGE_ID);
    expect(response.status).toBe(201);
    expect(subject.reports.reportChannelMessage).toHaveBeenCalledWith({ messageId: MESSAGE_ID, reporterUserId: "user-1", reason: "违规导流拉人，需要处理" });
  });

  it("answers a malformed message id exactly like a missing message, and refuses fabricated evidence", async () => {
    const subject = setup();
    const malformed = await subject.handlers.messageReport(
      mutate("/api/v1/club/channel/messages/xyz/reports", "POST", { reason: "违规导流拉人，需要处理" }), "xyz");
    expect(malformed.status).toBe(404);
    expect((await malformed.json()).error.code).toBe("MESSAGE_NOT_FOUND");
    const fabricated = await subject.handlers.messageReport(
      mutate(`/api/v1/club/channel/messages/${MESSAGE_ID}/reports`, "POST", { reason: "违规导流拉人，需要处理", excerpt: "编造的话" }), MESSAGE_ID);
    expect(fabricated.status).toBe(422);
    expect(subject.reports.reportChannelMessage).not.toHaveBeenCalled();
  });
});

describe("community rules acceptance", () => {
  it("reads the caller's own state and confirms idempotently", async () => {
    const subject = setup();
    const status = await subject.handlers.rulesGet(get("/api/v1/club/rules-acceptance"));
    expect(await status.json()).toEqual({ data: { version: "community:v1", confirmed: false } });
    const accept = await subject.handlers.rulesAccept(mutate("/api/v1/club/rules-acceptance", "POST"));
    expect(accept.status).toBe(200);
    expect(await accept.json()).toEqual({ data: { version: "community:v1", confirmed: true } });
    expect(subject.channel.acceptCommunityRules).toHaveBeenCalledWith("user-1");
  });
});
