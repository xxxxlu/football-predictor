import { describe, expect, it } from "vitest";
import {
  assertMinimalLobbyProjection,
  CHANNEL_MESSAGE_PROJECTION_KEYS,
  CHANNEL_MESSAGES_PER_WINDOW,
  CHANNEL_REPORT_SCOPE,
  CHANNEL_WINDOW_SECONDS,
  CHANNEL_WRITE_REFUSALS,
  COMMUNITY_RULES_VERSION,
  FRIEND_ACTIVITY_PROJECTION_KEYS,
  isDuplicateMessage,
  LOBBY_DIRECTORY_PROJECTION_KEYS,
  normalizeMessageBody,
} from "./channel.js";

describe("community rules version", () => {
  it("is a namespaced domain constant, distinct from the registration rules version", () => {
    expect(COMMUNITY_RULES_VERSION).toBe("community:v1");
    // The namespace prefix is what keeps the acceptance row separate under the
    // (user_id, rules_version) primary key.
    expect(COMMUNITY_RULES_VERSION.startsWith("community:")).toBe(true);
  });
});

describe("channel write limits", () => {
  it("is tighter than a room: 5 messages per 60 seconds for the one shared channel", () => {
    expect(CHANNEL_MESSAGES_PER_WINDOW).toBe(5);
    expect(CHANNEL_WINDOW_SECONDS).toBe(60);
  });

  it("shares the room-chat body rules — code points, 1 to 500, trimmed", () => {
    expect(normalizeMessageBody("  今晚谁夺冠？  ")).toBe("今晚谁夺冠？");
    expect(normalizeMessageBody("   ")).toBeNull();
    expect(normalizeMessageBody("长".repeat(500))).toBe("长".repeat(500));
    expect(normalizeMessageBody("长".repeat(501))).toBeNull();
    // Astral code points count as one, the PG char_length unit.
    expect(normalizeMessageBody("🎉".repeat(500))).toBe("🎉".repeat(500));
  });

  it("blocks only the exact consecutive duplicate", () => {
    expect(isDuplicateMessage("加油", "加油")).toBe(true);
    expect(isDuplicateMessage("加油", "加油!")).toBe(false);
    expect(isDuplicateMessage(null, "加油")).toBe(false);
  });

  it("names every refusal with its recovery-carrying status", () => {
    expect(CHANNEL_WRITE_REFUSALS).toEqual({
      RULES_CONFIRMATION_REQUIRED: 403,
      COMMUNITY_MUTED: 403,
      RATE_LIMITED: 429,
      DUPLICATE_MESSAGE: 422,
    });
  });
});

describe("channel report scope", () => {
  it("gives a channel report an explicit place label — never a NULL room name", () => {
    expect(CHANNEL_REPORT_SCOPE).toBe("PULSE CLUB");
  });
});

describe("lobby projection guard", () => {
  it("accepts each projection exactly as declared", () => {
    assertMinimalLobbyProjection(
      [{ id: "m1", authorPulseId: "lucy", authorNickname: null, body: "hi", createdAt: new Date() }],
      CHANNEL_MESSAGE_PROJECTION_KEYS,
    );
    assertMinimalLobbyProjection([{ pulseId: "lucy", nickname: "露西" }], LOBBY_DIRECTORY_PROJECTION_KEYS);
    assertMinimalLobbyProjection(
      [{ pulseId: "lucy", nickname: null, online: true, answeredToday: null }],
      FRIEND_ACTIVITY_PROJECTION_KEYS,
    );
  });

  it("refuses a widened join even when the key is not on any forbidden list", () => {
    expect(() => assertMinimalLobbyProjection({ pulseId: "lucy", nickname: null, email: "x@y.z" }, LOBBY_DIRECTORY_PROJECTION_KEYS))
      .toThrow(/unexpected key "email"/);
  });

  it("refuses every points-room category by name at any depth", () => {
    for (const key of ["roomId", "ticketCount", "ledgerId", "balance", "pointsTotal", "stake", "odds", "predictionId", "walletId", "settledAt", "inviteCode", "sessionId", "passwordHash", "recoveryCode", "tokenHash", "reportId"]) {
      expect(() => assertMinimalLobbyProjection({ pulseId: "lucy", nickname: { [key]: 1 } }, LOBBY_DIRECTORY_PROJECTION_KEYS))
        .toThrow(/lobby projection must never carry/);
    }
  });

  it("channel messages carry no pin slot — the channel has none", () => {
    expect(CHANNEL_MESSAGE_PROJECTION_KEYS).not.toContain("isPinned");
  });
});
