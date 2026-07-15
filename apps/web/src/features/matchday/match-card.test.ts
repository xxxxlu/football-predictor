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

  it.each([
    [{ homeScore: 2, awayScore: 1 }, "英格兰胜", "最终比分 英格兰 2 比 1 阿根廷"],
    [{ homeScore: 0, awayScore: 3 }, "阿根廷胜", "最终比分 英格兰 0 比 3 阿根廷"],
    [{ homeScore: 1, awayScore: 1 }, "平局", "最终比分 英格兰 1 比 1 阿根廷"],
  ])("shows the confirmed final score and outcome", (result, outcome, accessibleScore) => {
    const match: MatchView = {
      id: "finished-match",
      competitionName: "世界杯",
      homeTeam: "英格兰",
      awayTeam: "阿根廷",
      kickoffAt: "2026-07-14T12:00:00.000Z",
      state: "FINISHED",
      result,
    };

    const html = renderToStaticMarkup(createElement(MatchCard, { match }));

    expect(html).toContain(outcome);
    expect(html).toContain(`aria-label="${accessibleScore}"`);
  });

  it("does not guess a winner when a finished result is unconfirmed", () => {
    const match: MatchView = {
      id: "finished-match",
      competitionName: "世界杯",
      homeTeam: "英格兰",
      awayTeam: "阿根廷",
      kickoffAt: "2026-07-14T12:00:00.000Z",
      state: "FINISHED",
    };

    const html = renderToStaticMarkup(createElement(MatchCard, { match }));

    expect(html).toContain("赛果待确认");
    expect(html).not.toContain("英格兰胜");
    expect(html).not.toContain("阿根廷胜");
  });
});
