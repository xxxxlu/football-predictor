import { describe, expect, it } from "vitest";
import { formatEventTitle, formatSelectionLabel, scoreChipLabel } from "./selection-label.js";

describe("formatSelectionLabel", () => {
  it("labels the three 1X2 selections", () => {
    expect(formatSelectionLabel("HOME")).toBe("主胜");
    expect(formatSelectionLabel("DRAW")).toBe("平局");
    expect(formatSelectionLabel("AWAY")).toBe("客胜");
  });

  it("labels listed correct scores and the OTHER catch-all", () => {
    expect(formatSelectionLabel("2-1")).toBe("比分 2:1");
    expect(formatSelectionLabel("0-0")).toBe("比分 0:0");
    expect(formatSelectionLabel("OTHER")).toBe("其它比分");
  });

  it("labels the four encoded F1 selection shapes", () => {
    expect(formatSelectionLabel("DRV:VER")).toBe("头名 VER");
    expect(formatSelectionLabel("PODIUM:HAM:YES")).toBe("HAM 登领奖台");
    expect(formatSelectionLabel("PODIUM:HAM:NO")).toBe("HAM 无缘领奖台");
    expect(formatSelectionLabel("POD3:NOR-VER-PIA")).toBe("前三顺序 NOR·VER·PIA");
    expect(formatSelectionLabel("H2H:NOR>VER")).toBe("NOR 先于 VER");
  });

  it("returns an unrecognized selection verbatim instead of throwing", () => {
    expect(formatSelectionLabel("weird")).toBe("weird");
    expect(formatSelectionLabel("DRV:nor")).toBe("DRV:nor");
  });
});

describe("formatEventTitle", () => {
  it("renders football as a versus title and F1 as weekend · session", () => {
    expect(formatEventTitle({ matchId: "fixture-1", homeTeam: "法国", awayTeam: "西班牙" })).toBe("法国 对 西班牙");
    expect(formatEventTitle({ homeTeam: "法国", awayTeam: "西班牙" })).toBe("法国 对 西班牙");
    expect(formatEventTitle({ matchId: "f1:session-1", homeTeam: "HUNGARIAN GRAND PRIX", awayTeam: "GRAND_PRIX" })).toBe("HUNGARIAN GRAND PRIX · 正赛");
    expect(formatEventTitle({ matchId: "f1:session-1", homeTeam: "DUTCH GRAND PRIX", awayTeam: "SPRINT_QUALIFYING" })).toBe("DUTCH GRAND PRIX · 冲刺排位");
  });
});

describe("scoreChipLabel", () => {
  it("shows a compact score for the option buttons", () => {
    expect(scoreChipLabel("2-1")).toBe("2:1");
    expect(scoreChipLabel("3-3")).toBe("3:3");
    expect(scoreChipLabel("OTHER")).toBe("其它比分");
  });
});
