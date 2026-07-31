import { describe, expect, it } from "vitest";
import {
  appendPending,
  chatMessageLength,
  failPending,
  isMutedNow,
  listChatRequest,
  mergeConfirmed,
  MUTE_DURATION_OPTIONS,
  normalizeChatInput,
  removePending,
  reportChatMessageRequest,
  retryPending,
  sendChatRequest,
  unmuteMemberRequest,
  type ChatMessageRecord,
  type PendingMessage,
} from "./room-chat-flow";

const message = (id: string): ChatMessageRecord => ({ id, authorPulseId: "pulse_one", authorNickname: null, body: id, createdAt: "2026-07-31T12:00:00.000Z", isPinned: false });

describe("chat input validation", () => {
  it("counts code points, the same unit the server's CHECK counts", () => {
    expect(chatMessageLength("好球👍")).toBe(3);
    expect(normalizeChatInput(`  ${"好".repeat(500)}  `)).toBe("好".repeat(500));
    expect(normalizeChatInput("好".repeat(501))).toBeNull();
    expect(normalizeChatInput("   ")).toBeNull();
    expect(normalizeChatInput(" 今晚谁赢？ ")).toBe("今晚谁赢？");
  });
});

describe("chat requests", () => {
  it("builds same-origin JSON requests and escapes path segments", () => {
    expect(listChatRequest("room/1").url).toBe("/api/v1/rooms/room%2F1/messages");
    expect(listChatRequest("room-1", "a+b").url).toBe("/api/v1/rooms/room-1/messages?cursor=a%2Bb");
    const send = sendChatRequest("room-1", "你好");
    expect(send.init.method).toBe("POST");
    expect(send.init.credentials).toBe("same-origin");
    expect(JSON.parse(send.init.body)).toEqual({ body: "你好" });
    // The report payload carries only the reason — subject, excerpt and
    // sent-at are derived server-side from the message row.
    const report = reportChatMessageRequest("room-1", "message-1", "人身攻击，需要尽快处理");
    expect(JSON.parse(report.init.body)).toEqual({ reason: "人身攻击，需要尽快处理" });
    const unmute = unmuteMemberRequest("room-1", "mute-1", "误禁，解除");
    expect(unmute.init.method).toBe("DELETE");
    expect(JSON.parse(unmute.init.body)).toEqual({ reason: "误禁，解除" });
  });

  it("offers exactly the server's closed mute-duration list", () => {
    expect(MUTE_DURATION_OPTIONS.map((option) => option.hours)).toEqual([1, 24, 72, 168]);
  });
});

describe("optimistic send bookkeeping", () => {
  it("keeps a failed message for retry instead of silently dropping it", () => {
    let pending: PendingMessage[] = appendPending([], "local-1", "今晚谁赢？", "2026-07-31T12:00:00.000Z");
    expect(pending[0]).toMatchObject({ localId: "local-1", status: "sending" });
    pending = failPending(pending, "local-1", "发送失败");
    expect(pending[0]).toMatchObject({ status: "failed", error: "发送失败", body: "今晚谁赢？" });
    pending = retryPending(pending, "local-1");
    expect(pending[0]).toMatchObject({ status: "sending", error: undefined });
    expect(removePending(pending, "local-1")).toEqual([]);
  });

  it("merges a confirmed message once, even when the next poll already has it", () => {
    const list = [message("b"), message("a")];
    const merged = mergeConfirmed(list, message("c"));
    expect(merged.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    expect(mergeConfirmed(merged, message("c"))).toBe(merged);
  });
});

describe("mute window display", () => {
  it("is muted only while the window is still running", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    expect(isMutedNow("2026-07-31T13:00:00.000Z", now)).toBe(true);
    expect(isMutedNow("2026-07-31T11:00:00.000Z", now)).toBe(false);
    expect(isMutedNow(null, now)).toBe(false);
    expect(isMutedNow("not-a-date", now)).toBe(false);
  });
});
