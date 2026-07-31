import { describe, expect, it } from "vitest";

import {
  assertMinimalFriendProjection,
  BLOCK_PROJECTION_KEYS,
  FRIEND_LIST_PROJECTION_KEYS,
  FRIEND_REQUEST_PROJECTION_KEYS,
  PRESENCE_PREFERENCES_PROJECTION_KEYS,
} from "./projection.js";

describe("assertMinimalFriendProjection", () => {
  it("accepts the exact friend-list shape, including arrays", () => {
    const friends = [
      { userId: "u1", pulseId: "alice", nickname: "Alice", online: true },
      { userId: "u2", pulseId: "bob", nickname: null, online: false },
    ];
    expect(() => assertMinimalFriendProjection(friends, FRIEND_LIST_PROJECTION_KEYS)).not.toThrow();
  });

  it("accepts request, block, and preference shapes", () => {
    expect(() =>
      assertMinimalFriendProjection(
        { requestId: "r1", direction: "INCOMING", pulseId: "alice", nickname: "A", createdAt: "2026-07-31T00:00:00Z" },
        FRIEND_REQUEST_PROJECTION_KEYS,
      ),
    ).not.toThrow();
    expect(() =>
      assertMinimalFriendProjection(
        { userId: "u1", pulseId: "alice", nickname: null, createdAt: "2026-07-31T00:00:00Z" },
        BLOCK_PROJECTION_KEYS,
      ),
    ).not.toThrow();
    expect(() =>
      assertMinimalFriendProjection(
        { showOnlineToFriends: false, showLobbyToFriends: false },
        PRESENCE_PREFERENCES_PROJECTION_KEYS,
      ),
    ).not.toThrow();
  });

  it("throws on any key outside the allowlist", () => {
    expect(() =>
      assertMinimalFriendProjection({ userId: "u1", pulseId: "a", nickname: "A", online: true, email: "x" }, FRIEND_LIST_PROJECTION_KEYS),
    ).toThrow(/unexpected key "email"/);
  });

  it("throws loud on forbidden categories even if someone widens the allowlist", () => {
    for (const key of ["roomId", "balance", "points", "stake", "odds", "predictionCount", "walletId", "settledAt", "sessionToken", "passwordHash"]) {
      expect(() =>
        assertMinimalFriendProjection({ [key]: 1 }, [...FRIEND_LIST_PROJECTION_KEYS, key]),
      ).toThrow(/must never carry/);
    }
  });

  it("scans nested values recursively", () => {
    expect(() =>
      assertMinimalFriendProjection(
        { userId: "u1", pulseId: "a", nickname: { balance: 100 }, online: true },
        FRIEND_LIST_PROJECTION_KEYS,
      ),
    ).toThrow(/must never carry "balance"/);
  });

  it("passes through null, dates, and primitives", () => {
    expect(() => assertMinimalFriendProjection(null, FRIEND_LIST_PROJECTION_KEYS)).not.toThrow();
    expect(() =>
      assertMinimalFriendProjection({ userId: "u", pulseId: "a", nickname: null, online: false, createdAt: new Date() }, [
        ...FRIEND_LIST_PROJECTION_KEYS,
        "createdAt",
      ]),
    ).not.toThrow();
  });
});
