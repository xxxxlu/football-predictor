import { describe, expect, it } from "vitest";
import {
  appendPending,
  chatErrorKey,
  chatMessageLength,
  dropDeliveredPending,
  failPending,
  isMutedNow,
  listChatRequest,
  mergeConfirmed,
  MUTE_DURATION_OPTIONS,
  normalizeChatInput,
  reconcileMessages,
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

  it("keeps a just-confirmed message when a stale poll snapshot lands after it", () => {
    const at = (id: string, createdAt: string) => ({ ...message(id), createdAt });
    const current = [at("confirmed", "2026-07-31T12:00:05.000Z"), at("b", "2026-07-31T12:00:00.000Z")];
    // The poll was issued before the send committed: its snapshot lacks "confirmed".
    const stale = [at("b", "2026-07-31T12:00:00.000Z"), at("a", "2026-07-31T11:59:00.000Z")];
    expect(reconcileMessages(current, stale).map((entry) => entry.id)).toEqual(["confirmed", "b", "a"]);
    // A snapshot that already contains it wins as-is (no duplicate).
    const fresh = [at("confirmed", "2026-07-31T12:00:05.000Z"), at("b", "2026-07-31T12:00:00.000Z")];
    expect(reconcileMessages(current, fresh).map((entry) => entry.id)).toEqual(["confirmed", "b"]);
    // Moderation removals still land: an older message absent from the
    // snapshot is dropped, not resurrected.
    const hiddenB = [at("confirmed", "2026-07-31T12:00:05.000Z")];
    expect(reconcileMessages(current, hiddenB).map((entry) => entry.id)).toEqual(["confirmed"]);
  });

  it("retires a sending entry the poll confirmed as OURS, but never a failed one", () => {
    const pending: PendingMessage[] = [
      { localId: "l1", body: "已被确认的话", createdAt: "2026-07-31T12:00:00.000Z", status: "sending" },
      { localId: "l2", body: "还在路上的话", createdAt: "2026-07-31T12:00:01.000Z", status: "sending" },
      { localId: "l3", body: "已被确认的话", createdAt: "2026-07-31T12:00:02.000Z", status: "failed", error: "x" },
    ];
    const polled = [{ ...message("m1"), body: "已被确认的话" }];
    expect(dropDeliveredPending(pending, polled, "pulse_one").map((entry) => entry.localId)).toEqual(["l2", "l3"]);
  });

  it("never retires a sending entry for a STRANGER's identical text, nor before the viewer is known", () => {
    const pending: PendingMessage[] = [
      { localId: "l1", body: "同一句话", createdAt: "2026-07-31T12:00:00.000Z", status: "sending" },
    ];
    const polled = [{ ...message("m1"), body: "同一句话" }];
    // Another member posted the same text — our POST may still fail; keep the row.
    expect(dropDeliveredPending(pending, polled, "pulse_two").map((entry) => entry.localId)).toEqual(["l1"]);
    // Viewer identity unknown (nothing sent yet this mount) — drop nothing.
    expect(dropDeliveredPending(pending, polled, null).map((entry) => entry.localId)).toEqual(["l1"]);
  });
});

describe("error-code localization", () => {
  it("maps every chat business rejection to an i18n key, with a generic fallback", () => {
    expect(chatErrorKey("MUTED")).toBe("chat.err.MUTED");
    expect(chatErrorKey("RULES_CONFIRMATION_REQUIRED")).toBe("chat.err.RULES_CONFIRMATION_REQUIRED");
    expect(chatErrorKey("COMMUNITY_MUTED")).toBe("chat.err.COMMUNITY_MUTED");
    expect(chatErrorKey("DUPLICATE_MESSAGE")).toBe("chat.err.DUPLICATE_MESSAGE");
    expect(chatErrorKey("RATE_LIMITED")).toBe("chat.err.RATE_LIMITED");
    expect(chatErrorKey("SOMETHING_NEW")).toBe("room.chat.errorGeneric");
    expect(chatErrorKey(undefined)).toBe("room.chat.errorGeneric");
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
