import { describe, expect, it } from "vitest";

import {
  assertMinimalChatProjection,
  CHAT_MESSAGE_PROJECTION_KEYS,
  decodeChatCursor,
  encodeChatCursor,
  isDuplicateMessage,
  MESSAGE_MAX_LENGTH,
  MESSAGE_WINDOW_SECONDS,
  MESSAGES_PER_WINDOW,
  messageBodyLength,
  normalizeMessageBody,
} from "./chat.js";

describe("message body rules", () => {
  it("counts code points the way PG char_length does", () => {
    expect(messageBodyLength("abc")).toBe(3);
    // Three emoji are six UTF-16 units but three code points.
    expect(messageBodyLength("😀😀😀")).toBe(3);
  });

  it("trims and bounds to 1-500 code points", () => {
    expect(normalizeMessageBody("  hello  ")).toBe("hello");
    expect(normalizeMessageBody("   ")).toBeNull();
    expect(normalizeMessageBody("")).toBeNull();
    expect(normalizeMessageBody("x".repeat(MESSAGE_MAX_LENGTH))).toHaveLength(MESSAGE_MAX_LENGTH);
    expect(normalizeMessageBody("x".repeat(MESSAGE_MAX_LENGTH + 1))).toBeNull();
    // 500 emoji are 1000 UTF-16 units but exactly 500 code points — allowed.
    expect(normalizeMessageBody("😀".repeat(MESSAGE_MAX_LENGTH))).not.toBeNull();
  });

  it("flags only an exact consecutive repeat as duplicate", () => {
    expect(isDuplicateMessage("hello", "hello")).toBe(true);
    expect(isDuplicateMessage("hello", "hello!")).toBe(false);
    expect(isDuplicateMessage(null, "hello")).toBe(false);
  });

  it("keeps the story-approved rate window", () => {
    expect(MESSAGES_PER_WINDOW).toBe(10);
    expect(MESSAGE_WINDOW_SECONDS).toBe(60);
  });
});

describe("chat projection guard", () => {
  it("accepts the exact member read model", () => {
    const rows = [{
      id: "cccccccc-0000-0000-0000-000000000003",
      authorPulseId: "alice", authorNickname: "Alice", body: "hi", createdAt: new Date(), isPinned: false,
    }];
    expect(() => assertMinimalChatProjection(rows)).not.toThrow();
  });

  it("rejects unexpected keys and points/ledger categories outright", () => {
    expect(() => assertMinimalChatProjection({ id: "x", authorPulseId: "a", authorNickname: null, body: "b", createdAt: new Date(), isPinned: false, roomId: "r" })).toThrow(/unexpected key "roomId"/);
    for (const key of ["stake", "balance", "ledgerRef", "predictionId", "oddsVersion", "reportId", "sessionToken"]) {
      expect(() => assertMinimalChatProjection({ [key]: 1 }, [...CHAT_MESSAGE_PROJECTION_KEYS, key])).toThrow(/must never carry/);
    }
  });
});

describe("chat cursor", () => {
  const cursor = { createdAt: "2026-07-31T10:00:00.000Z", id: "cccccccc-0000-0000-0000-000000000003" };

  it("round-trips through base64url", () => {
    expect(decodeChatCursor(encodeChatCursor(cursor))).toEqual(cursor);
  });

  it("refuses malformed cursors instead of silently restarting from page one", () => {
    expect(decodeChatCursor("not-base64-json")).toBeNull();
    expect(decodeChatCursor(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull();
    expect(decodeChatCursor(Buffer.from(JSON.stringify({ createdAt: "nope", id: cursor.id }), "utf8").toString("base64url"))).toBeNull();
    expect(decodeChatCursor(Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: "1 OR 1=1" }), "utf8").toString("base64url"))).toBeNull();
  });
});
