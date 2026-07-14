import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchCard } from "../../components/match-card.js";
import type { MatchView } from "./types.js";

describe("MatchCard", () => {
  it("keeps current three-way odds visible in a dense match list", () => {
    const match: MatchView = {
      id: "match-1",
      competitionName: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      kickoffAt: "2026-07-14T12:00:00.000Z",
      state: "OPEN",
      market: { id: "market-1", version: "2", home: "2.10", draw: "3.20", away: "3.40" },
    };

    const html = renderToStaticMarkup(createElement(MatchCard, { match }));

    expect(html).toContain("主胜");
    expect(html).toContain("2.10");
    expect(html).toContain("平局");
    expect(html).toContain("3.20");
    expect(html).toContain("客胜");
    expect(html).toContain("3.40");
  });
});
