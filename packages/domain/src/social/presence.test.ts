import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRESENCE_PREFERENCES,
  isPresenceFresh,
  PRESENCE_TTL_MS,
  presenceVisibleTo,
} from "./presence.js";

const NOW = new Date("2026-07-31T12:00:00Z");
const FRESH = new Date(NOW.getTime() - 30_000);
const STALE = new Date(NOW.getTime() - PRESENCE_TTL_MS - 1);

describe("presence defaults", () => {
  it("keeps every display toggle off by default (privacy-first)", () => {
    expect(DEFAULT_PRESENCE_PREFERENCES).toEqual({
      showOnlineToFriends: false,
      showLobbyToFriends: false,
      showInLobbyDirectory: false,
    });
  });
});

describe("isPresenceFresh", () => {
  it("treats a beat inside the TTL as fresh and everything else as offline", () => {
    expect(isPresenceFresh(FRESH, NOW)).toBe(true);
    expect(isPresenceFresh(STALE, NOW)).toBe(false);
    expect(isPresenceFresh(new Date(NOW.getTime() - PRESENCE_TTL_MS), NOW)).toBe(false);
    expect(isPresenceFresh(null, NOW)).toBe(false);
    expect(isPresenceFresh(undefined, NOW)).toBe(false);
  });
});

describe("presenceVisibleTo", () => {
  const visible = {
    friendshipStatus: "ACCEPTED" as const,
    blocked: false,
    targetOptedIn: true,
    beatAt: FRESH,
    now: NOW,
  };

  it("shows online only when all four FR85 conditions hold", () => {
    expect(presenceVisibleTo(visible)).toBe(true);
  });

  it("reads offline when any single condition fails", () => {
    expect(presenceVisibleTo({ ...visible, friendshipStatus: "PENDING" })).toBe(false);
    expect(presenceVisibleTo({ ...visible, friendshipStatus: null })).toBe(false);
    expect(presenceVisibleTo({ ...visible, blocked: true })).toBe(false);
    expect(presenceVisibleTo({ ...visible, targetOptedIn: false })).toBe(false);
    expect(presenceVisibleTo({ ...visible, beatAt: STALE })).toBe(false);
    expect(presenceVisibleTo({ ...visible, beatAt: null })).toBe(false);
  });
});
