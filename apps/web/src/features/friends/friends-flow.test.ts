import { describe, expect, it } from "vitest";

import {
  friendErrorKey,
  FRIENDS_POLL_INTERVAL_MS,
  normalizePulseIdInput,
  requestOutcomeKey,
  shouldSendHeartbeat,
  splitRequests,
  type FriendRequestEntry,
} from "./friends-flow.js";

describe("normalizePulseIdInput", () => {
  it("matches the server's rules: trim, lowercase, 3-32 of [a-z0-9_]", () => {
    expect(normalizePulseIdInput("  Bob_01 ")).toBe("bob_01");
    expect(normalizePulseIdInput("ab")).toBeNull();
    expect(normalizePulseIdInput("has space")).toBeNull();
    expect(normalizePulseIdInput("emoji🙂")).toBeNull();
    expect(normalizePulseIdInput("a".repeat(33))).toBeNull();
  });
});

describe("splitRequests", () => {
  it("separates the inbox from sent requests without dropping entries", () => {
    const make = (direction: "INCOMING" | "OUTGOING", id: string): FriendRequestEntry => ({
      requestId: id, direction, userId: `user-${id}`, pulseId: "p", nickname: null, createdAt: "2026-07-31T00:00:00Z",
    });
    const { incoming, outgoing } = splitRequests([make("INCOMING", "1"), make("OUTGOING", "2"), make("INCOMING", "3")]);
    expect(incoming.map((entry) => entry.requestId)).toEqual(["1", "3"]);
    expect(outgoing.map((entry) => entry.requestId)).toEqual(["2"]);
  });
});

describe("copy", () => {
  it("keeps the pending outcome identical for reachable and blocked targets", () => {
    // Both cases answer PENDING server-side; a distinct message would leak the block.
    expect(requestOutcomeKey("PENDING")).toBe("friends.outcomePending");
    expect(requestOutcomeKey("ACCEPTED")).toBe("friends.outcomeAccepted");
  });

  it("has a key for every API error the feature can produce, plus a fallback", () => {
    for (const code of ["USER_NOT_FOUND", "SELF_FRIEND_FORBIDDEN", "SELF_BLOCK_FORBIDDEN", "RATE_LIMITED", "REQUEST_NOT_FOUND", "INVALID_REQUEST", "UNAUTHENTICATED"]) {
      expect(friendErrorKey(code)).not.toBe(friendErrorKey(undefined));
    }
    expect(friendErrorKey("SOMETHING_ELSE")).toBe(friendErrorKey(undefined));
  });
});

describe("heartbeat gating", () => {
  it("beats only when the user opted into at least one presence toggle", () => {
    expect(shouldSendHeartbeat(null)).toBe(false);
    expect(shouldSendHeartbeat({ showOnlineToFriends: false, showLobbyToFriends: false })).toBe(false);
    expect(shouldSendHeartbeat({ showOnlineToFriends: true, showLobbyToFriends: false })).toBe(true);
    expect(shouldSendHeartbeat({ showOnlineToFriends: false, showLobbyToFriends: true })).toBe(true);
  });

  it("polls inside the 30-60s cadence the 90s presence TTL expects", () => {
    expect(FRIENDS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(FRIENDS_POLL_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});
