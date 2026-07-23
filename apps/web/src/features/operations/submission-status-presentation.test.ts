import { describe, expect, it } from "vitest";
import { submissionEventTitle, submissionStatusLabel, submissionSummary } from "./submission-status-presentation";

describe("submission status presentation", () => {
  it("titles football as a versus pairing and F1 as weekend · session", () => {
    expect(submissionEventTitle({ matchId: "api-football:1", homeTeam: "法国", awayTeam: "西班牙" })).toBe("法国 对 西班牙");
    expect(submissionEventTitle({ matchId: "f1:session-1", homeTeam: "HUNGARIAN GRAND PRIX", awayTeam: "QUALIFYING" })).toBe("HUNGARIAN GRAND PRIX · 排位赛");
    expect(submissionEventTitle({ matchId: "f1:session-2", homeTeam: "DUTCH GRAND PRIX", awayTeam: "SPRINT" })).toBe("DUTCH GRAND PRIX · 冲刺赛");
  });

  it("labels the shared phases in Chinese", () => {
    expect(submissionStatusLabel("OPEN")).toBe("可参与");
    expect(submissionStatusLabel("CLOSED")).toBe("已封盘");
    expect(submissionStatusLabel("FINISHED")).toBe("已结束");
  });

  it("counts submitted members without touching anything else", () => {
    expect(submissionSummary([
      { userId: "a", displayName: "甲", submitted: true },
      { userId: "b", displayName: "乙", submitted: false },
      { userId: "c", displayName: "丙", submitted: true },
    ])).toEqual({ submitted: 2, total: 3 });
    expect(submissionSummary([])).toEqual({ submitted: 0, total: 0 });
  });
});
