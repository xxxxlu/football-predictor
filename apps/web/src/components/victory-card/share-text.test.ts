import { describe, expect, it } from "vitest";
import { buildVictoryShareText, formatShareTitle } from "./share-text";
import type { SingleMatchVictoryData, SeasonVictoryData } from "./types";

describe("victory share text builder", () => {
  const matchData: SingleMatchVictoryData = {
    kind: "MATCH",
    competition: "英格兰超级联赛",
    homeTeam: "曼彻斯特城",
    awayTeam: "阿森纳",
    kickoffAt: "2026-10-24T19:00:00Z",
    selection: "主胜",
    odds: "2.10",
    stakePoints: "1,000",
    grossReturnPoints: "2,100",
    netPoints: "+1,100 PTS",
    outcome: "WIN",
    ticketId: "TCK-2026-9999",
  };

  const seasonData: SeasonVictoryData = {
    kind: "SEASON",
    seasonLabel: "2026/27",
    netPoints: "+15,400 PTS",
    hitRate: "80%",
    settledTickets: 40,
    wins: 32,
    voids: 2,
    coveredTickets: 40,
  };

  it("builds localized titles for match victories", () => {
    expect(formatShareTitle({ data: matchData, locale: "zh-CN" })).toBe("PULSE 命中战报：曼彻斯特城 对 阿森纳");
    expect(formatShareTitle({ data: matchData, locale: "en" })).toBe("PULSE Victory: 曼彻斯特城 vs 阿森纳");
    expect(formatShareTitle({ data: matchData, locale: "de" })).toBe("PULSE Spieltag-Erfolg: 曼彻斯特城 vs 阿森纳");
    expect(formatShareTitle({ data: matchData, locale: "es" })).toBe("PULSE Pronóstico Ganador: 曼彻斯特城 vs 阿森纳");
  });

  it("formats rich match victory text across languages", () => {
    const zh = buildVictoryShareText({ data: matchData, locale: "zh-CN" });
    expect(zh).toContain("【PULSE 体育俱乐部 · 命中战报】");
    expect(zh).toContain("🎯 判断：主胜 @ 2.10");
    expect(zh).toContain("💰 净积分收益：+1,100 PTS");
    expect(zh).toContain("#TCK-2026-9999");

    const en = buildVictoryShareText({ data: matchData, locale: "en", url: "https://pulse.app/record" });
    expect(en).toContain("[PULSE Sports Club · Victory Ticket]");
    expect(en).toContain("Net Profit: +1,100 PTS");
    expect(en).toContain("🔗 https://pulse.app/record");
  });

  it("formats season performance summary across languages", () => {
    const zh = buildVictoryShareText({ data: seasonData, locale: "zh-CN" });
    expect(zh).toContain("赛季长期战绩");
    expect(zh).toContain("80%");
    expect(zh).toContain("+15,400 PTS");

    const de = buildVictoryShareText({ data: seasonData, locale: "de" });
    expect(de).toContain("Saison-Leistung");
    expect(de).toContain("Trefferquote: 80%");
  });
});
