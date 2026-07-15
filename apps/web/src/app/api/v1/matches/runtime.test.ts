import { describe, expect, it } from "vitest";
import { CurrentMatchCache, visibleCurrentMatches } from "./runtime.js";

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
