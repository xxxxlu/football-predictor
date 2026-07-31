import { describe, expect, it } from "vitest";

import {
  canRespondToRequest,
  canonicalPair,
  decideFriendRequest,
  FRIEND_REQUESTS_PER_DAY,
  FRIEND_REQUESTS_PER_HOUR,
  normalizePulseId,
} from "./friendship.js";

describe("normalizePulseId", () => {
  it("shares the login username rules exactly", () => {
    expect(normalizePulseId("  Boss_01 ")).toBe("boss_01");
    expect(normalizePulseId("AB")).toBeNull();
    expect(normalizePulseId("has space")).toBeNull();
    expect(normalizePulseId("emoji🙂")).toBeNull();
    expect(normalizePulseId("a".repeat(33))).toBeNull();
  });
});

describe("canonicalPair", () => {
  it("orders any two ids the same way regardless of argument order", () => {
    expect(canonicalPair("b", "a")).toEqual({ loUserId: "a", hiUserId: "b" });
    expect(canonicalPair("a", "b")).toEqual({ loUserId: "a", hiUserId: "b" });
  });

  it("rejects a self pair", () => {
    expect(() => canonicalPair("a", "a")).toThrow(/distinct/);
  });
});

describe("decideFriendRequest", () => {
  it("creates when no relationship exists", () => {
    expect(decideFriendRequest({ requesterId: "a", targetId: "b", existing: null, blocked: false })).toEqual({
      kind: "CREATE",
    });
  });

  it("suppresses with no write when a block exists in either direction", () => {
    expect(
      decideFriendRequest({
        requesterId: "a",
        targetId: "b",
        existing: { status: "PENDING", requestedBy: "b" },
        blocked: true,
      }),
    ).toEqual({ kind: "SUPPRESS" });
  });

  it("accepts when the other side already has a pending request (mutual intent)", () => {
    expect(
      decideFriendRequest({
        requesterId: "a",
        targetId: "b",
        existing: { status: "PENDING", requestedBy: "b" },
        blocked: false,
      }),
    ).toEqual({ kind: "ACCEPT" });
  });

  it("replays idempotently when the same requester repeats a pending request", () => {
    expect(
      decideFriendRequest({
        requesterId: "a",
        targetId: "b",
        existing: { status: "PENDING", requestedBy: "a" },
        blocked: false,
      }),
    ).toEqual({ kind: "NOOP", status: "PENDING" });
  });

  it("is a no-op when already friends", () => {
    expect(
      decideFriendRequest({
        requesterId: "a",
        targetId: "b",
        existing: { status: "ACCEPTED", requestedBy: "b" },
        blocked: false,
      }),
    ).toEqual({ kind: "NOOP", status: "ACCEPTED" });
  });

  it("refuses a self request outright", () => {
    expect(() => decideFriendRequest({ requesterId: "a", targetId: "a", existing: null, blocked: false })).toThrow(
      /themselves/,
    );
  });
});

describe("canRespondToRequest", () => {
  it("lets only the recipient of a pending request respond", () => {
    expect(canRespondToRequest({ responderId: "b", requestedBy: "a", status: "PENDING" })).toBe(true);
    expect(canRespondToRequest({ responderId: "a", requestedBy: "a", status: "PENDING" })).toBe(false);
    expect(canRespondToRequest({ responderId: "b", requestedBy: "a", status: "ACCEPTED" })).toBe(false);
  });
});

describe("rate limit thresholds", () => {
  it("stays at the story-approved values", () => {
    expect(FRIEND_REQUESTS_PER_HOUR).toBe(10);
    expect(FRIEND_REQUESTS_PER_DAY).toBe(50);
  });
});
