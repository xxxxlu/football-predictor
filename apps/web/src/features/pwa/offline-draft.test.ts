import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discardOfflineDraft,
  hasOfflineDrafts,
  loadOfflineDraft,
  purgeOfflineDrafts,
  revalidateDraft,
  saveOfflineDraft,
  type OfflineDraft,
} from "./offline-draft";

class FakeLocalStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

let localStorage: FakeLocalStorage;

beforeEach(() => {
  localStorage = new FakeLocalStorage();
  (globalThis as Record<string, unknown>).window = { localStorage };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

const draft: OfflineDraft = {
  v: 1,
  roomId: "room-1",
  eventKey: "match-9",
  marketId: "77",
  marketVersion: "odds-v1",
  selection: "HOME",
  decimalOdds: "3.00",
  stakePoints: "800",
  savedAt: "2026-07-23T10:00:00.000Z",
};

describe("offline draft storage (7.3b)", () => {
  it("round-trips a draft per room + event", () => {
    saveOfflineDraft(draft);
    expect(loadOfflineDraft("room-1", "match-9")).toEqual(draft);
    expect(loadOfflineDraft("room-1", "other-match")).toBeNull();
    expect(loadOfflineDraft("other-room", "match-9")).toBeNull();
  });

  it("rejects corrupted or incomplete stored payloads instead of throwing", () => {
    localStorage.setItem("pulse-draft-v1:room-1:match-9", "{not json");
    expect(loadOfflineDraft("room-1", "match-9")).toBeNull();
    localStorage.setItem("pulse-draft-v1:room-1:match-9", JSON.stringify({ ...draft, selection: undefined }));
    expect(loadOfflineDraft("room-1", "match-9")).toBeNull();
    localStorage.setItem("pulse-draft-v1:room-1:match-9", JSON.stringify({ ...draft, v: 2 }));
    expect(loadOfflineDraft("room-1", "match-9")).toBeNull();
  });

  it("discard removes exactly the addressed draft", () => {
    saveOfflineDraft(draft);
    saveOfflineDraft({ ...draft, eventKey: "f1:session-1" });
    discardOfflineDraft("room-1", "match-9");
    expect(loadOfflineDraft("room-1", "match-9")).toBeNull();
    expect(loadOfflineDraft("room-1", "f1:session-1")).not.toBeNull();
  });

  it("purge deletes every draft and nothing else", () => {
    saveOfflineDraft(draft);
    saveOfflineDraft({ ...draft, roomId: "room-2" });
    localStorage.setItem("unrelated-key", "keep-me");
    expect(hasOfflineDrafts()).toBe(true);
    purgeOfflineDrafts();
    expect(hasOfflineDrafts()).toBe(false);
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
  });

  it("is a no-op without a window (SSR safety)", () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(() => saveOfflineDraft(draft)).not.toThrow();
    expect(loadOfflineDraft("room-1", "match-9")).toBeNull();
    expect(hasOfflineDrafts()).toBe(false);
    expect(() => purgeOfflineDrafts()).not.toThrow();
  });
});

describe("draft revalidation on reconnect (7.3b)", () => {
  const unchanged = { open: true, marketId: "77", marketVersion: "odds-v1", decimalOdds: "3.00" };

  it("UNCHANGED only when nothing moved while offline", () => {
    expect(revalidateDraft(draft, unchanged)).toBe("UNCHANGED");
  });

  it("EVENT_CLOSED when the event stopped accepting submissions", () => {
    expect(revalidateDraft(draft, { ...unchanged, open: false })).toBe("EVENT_CLOSED");
  });

  it("MARKET_CHANGED when the market disappeared or was replaced", () => {
    expect(revalidateDraft(draft, { ...unchanged, marketId: undefined })).toBe("MARKET_CHANGED");
    expect(revalidateDraft(draft, { ...unchanged, marketId: "88" })).toBe("MARKET_CHANGED");
  });

  it("ODDS_CHANGED when the version or the selection's odds moved", () => {
    expect(revalidateDraft(draft, { ...unchanged, marketVersion: "odds-v2" })).toBe("ODDS_CHANGED");
    expect(revalidateDraft(draft, { ...unchanged, decimalOdds: "3.15" })).toBe("ODDS_CHANGED");
    // Selection no longer offered → its current odds are unknown → not submittable as-is.
    expect(revalidateDraft(draft, { ...unchanged, decimalOdds: undefined })).toBe("ODDS_CHANGED");
  });

  it("numeric market ids compare against the stored string form", () => {
    expect(revalidateDraft(draft, { ...unchanged, marketId: 77 })).toBe("UNCHANGED");
  });
});
