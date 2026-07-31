import { describe, expect, it } from "vitest";
import {
  acceptCommunityRulesRequest,
  appendPending,
  failPending,
  isMutedNow,
  listChannelRequest,
  LOBBY_HEARTBEAT_INTERVAL_MS,
  lobbyHeartbeatRequest,
  lobbyRequest,
  mergeConfirmedChannelMessage,
  normalizeChatInput,
  removePending,
  reportChannelMessageRequest,
  retryPending,
  sendChannelRequest,
  type ChannelMessageRecord,
  type PendingMessage,
} from "./club-lobby-flow";

const message = (id: string): ChannelMessageRecord => ({ id, authorPulseId: "lucy", authorNickname: null, body: id, createdAt: "2026-07-31T12:00:00.000Z" });

describe("request builders", () => {
  it("addresses the club endpoints with same-origin credentials", () => {
    expect(lobbyRequest()).toEqual({ url: "/api/v1/club/lobby", init: { credentials: "same-origin" } });
    expect(listChannelRequest().url).toBe("/api/v1/club/channel/messages");
    expect(listChannelRequest("a b").url).toBe("/api/v1/club/channel/messages?cursor=a%20b");
    const send = sendChannelRequest("你好");
    expect(send.url).toBe("/api/v1/club/channel/messages");
    expect(send.init.method).toBe("POST");
    expect(JSON.parse(send.init.body as string)).toEqual({ body: "你好" });
    const report = reportChannelMessageRequest("msg/1", "违规导流拉人，需要处理");
    expect(report.url).toBe("/api/v1/club/channel/messages/msg%2F1/reports");
    expect(acceptCommunityRulesRequest().url).toBe("/api/v1/club/rules-acceptance");
  });

  it("declares the lobby surface on the shared 12.1 heartbeat endpoint", () => {
    const heartbeat = lobbyHeartbeatRequest();
    expect(heartbeat.url).toBe("/api/v1/presence/heartbeat");
    expect(JSON.parse(heartbeat.init.body as string)).toEqual({ surface: "lobby" });
    // Cadence sits comfortably inside the server's 90s presence TTL.
    expect(LOBBY_HEARTBEAT_INTERVAL_MS).toBeLessThan(90_000);
  });
});

describe("channel bookkeeping", () => {
  it("reuses the 12.3 optimistic-send lifecycle", () => {
    let pending: PendingMessage[] = [];
    pending = appendPending(pending, "local-1", "你好", "2026-07-31T12:00:00.000Z");
    expect(pending[0]).toMatchObject({ localId: "local-1", status: "sending" });
    pending = failPending(pending, "local-1", "发送失败");
    expect(pending[0]).toMatchObject({ status: "failed", error: "发送失败" });
    pending = retryPending(pending, "local-1");
    expect(pending[0]).toMatchObject({ status: "sending", error: undefined });
    expect(removePending(pending, "local-1")).toEqual([]);
  });

  it("merges a confirmed message once, at the newest end", () => {
    const messages = [message("b"), message("a")];
    const merged = mergeConfirmedChannelMessage(messages, message("c"));
    expect(merged.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    expect(mergeConfirmedChannelMessage(merged, message("c"))).toBe(merged);
  });

  it("keeps the code-point validation of the shared chat input", () => {
    expect(normalizeChatInput("  你好  ")).toBe("你好");
    expect(normalizeChatInput("🎉".repeat(500))).toBe("🎉".repeat(500));
    expect(normalizeChatInput("🎉".repeat(501))).toBeNull();
    expect(isMutedNow("2026-07-31T13:00:00.000Z", new Date("2026-07-31T12:00:00.000Z"))).toBe(true);
    expect(isMutedNow("2026-07-31T13:00:00.000Z", new Date("2026-07-31T14:00:00.000Z"))).toBe(false);
    expect(isMutedNow(null, new Date())).toBe(false);
  });
});
