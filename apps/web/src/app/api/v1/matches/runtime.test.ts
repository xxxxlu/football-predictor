import { describe, expect, it, vi } from "vitest";
import { CurrentMatchCache, MATCH_LIST_MEMO_MS, visibleCurrentMatches } from "./runtime.js";

describe("current match runtime", () => {
  it("keeps the complete 2026 competition history together with future and live matches", () => {
    const views = [
      { id: "group-stage", status: "FINISHED", kickoffAt: "2026-06-11T12:00:00Z" },
      { id: "past-scheduled", status: "SCHEDULED", kickoffAt: "2026-07-14T09:00:00Z" },
      { id: "live", status: "LIVE", kickoffAt: "2026-07-14T09:00:00Z" },
      { id: "semi-final", status: "SCHEDULED", kickoffAt: "2026-07-14T19:00:00Z" },
    ];
    expect(visibleCurrentMatches(views, new Date("2026-07-14T10:00:00Z")).map((view) => view.id)).toEqual(["group-stage", "live", "semi-final"]);
  });

  it("serves the database cache without calling external suppliers during user reads", async () => {
    const reader = { list: async () => ({ views: [{ id: "semi-final", status: "SCHEDULED", kickoffAt: "2026-07-14T19:00:00Z" }], etag: '"all"' }), get: async () => ({ view: { id: "semi-final" }, etag: '"one"' }) };
    const cache = new CurrentMatchCache({ reader, now: () => new Date("2026-07-14T10:00:00Z") });

    await expect(cache.list()).resolves.toMatchObject({ views: [{ id: "semi-final" }] });
  });
});

// The match list is the product's hottest read: five queries, a view build and
// a sha256 over the whole payload — and before the memo every one of those ran
// again just to discover the caller already had the answer (304).
describe("match list memo", () => {
  const START = Date.parse("2026-07-14T10:00:00Z");
  const views = [
    { id: "live", status: "LIVE", kickoffAt: "2026-07-14T09:00:00Z" },
    { id: "tonight", status: "SCHEDULED", kickoffAt: "2026-07-14T19:00:00Z" },
  ];

  function setup(input: { views?: typeof views } = {}) {
    let nowMs = START;
    const list = vi.fn(async () => ({ views: input.views ?? views, etag: '"upstream"' }));
    const cache = new CurrentMatchCache({
      reader: { list, get: async () => ({ view: {}, etag: '"one"' }) },
      now: () => new Date(nowMs),
    });
    return { cache, list, advance: (ms: number) => { nowMs += ms; } };
  }

  it("serves repeat reads from memory instead of re-querying", async () => {
    const { cache, list, advance } = setup();
    const first = await cache.list();
    advance(MATCH_LIST_MEMO_MS - 1);
    const second = await cache.list();
    expect(list).toHaveBeenCalledTimes(1);
    // Same etag object identity is what makes the 304 comparison free.
    expect(second.etag).toBe(first.etag);
    expect(second.views).toEqual(first.views);
  });

  it("reads again once the memo window closes", async () => {
    const { cache, list, advance } = setup();
    await cache.list();
    advance(MATCH_LIST_MEMO_MS);
    await cache.list();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("expires early when a scheduled match kicks off inside the window", async () => {
    // Correctness bound: visibleCurrentMatches drops a SCHEDULED match the
    // moment its kickoff passes, so the memo must not outlive that instant.
    const soon = new Date(START + 5_000).toISOString();
    const { cache, list, advance } = setup({ views: [{ id: "imminent", status: "SCHEDULED", kickoffAt: soon }] });
    await expect(cache.list()).resolves.toMatchObject({ views: [{ id: "imminent" }] });
    advance(6_000);
    await expect(cache.list()).resolves.toMatchObject({ views: [] });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps a finished-only list memoized for the whole window", async () => {
    // No SCHEDULED view means no visibility boundary; only the window applies.
    const { cache, list, advance } = setup({ views: [{ id: "done", status: "FINISHED", kickoffAt: "2026-07-13T09:00:00Z" }] });
    await cache.list();
    advance(MATCH_LIST_MEMO_MS - 1);
    await cache.list();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent cold reads into one query", async () => {
    const { cache, list } = setup();
    const [a, b, c] = await Promise.all([cache.list(), cache.list(), cache.list()]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(a.etag).toBe(b.etag);
    expect(b.etag).toBe(c.etag);
  });

  it("memoizes freshness but retries after a failure rather than caching 'unknown'", async () => {
    let nowMs = START;
    let attempts = 0;
    const freshness = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("aggregate unavailable");
      return { lastCapturedAt: "2026-07-14T09:00:00Z", nextKickoffAt: null, nextKickoffCompetition: null, upcomingCount: 1, liveCount: 0, finishedRecentCount: 0 };
    });
    const cache = new CurrentMatchCache({
      reader: { list: async () => ({ views, etag: '"upstream"' }), get: async () => ({ view: {}, etag: '"one"' }) },
      freshness,
      now: () => new Date(nowMs),
    });

    await expect(cache.freshness()).resolves.toBeNull();
    await expect(cache.freshness()).resolves.toMatchObject({ upcomingCount: 1 });
    expect(freshness).toHaveBeenCalledTimes(2);
    nowMs += MATCH_LIST_MEMO_MS - 1;
    await expect(cache.freshness()).resolves.toMatchObject({ upcomingCount: 1 });
    expect(freshness).toHaveBeenCalledTimes(2);
  });
});
