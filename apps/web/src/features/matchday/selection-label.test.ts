import { describe, expect, it } from "vitest";
import { formatSelectionLabel, scoreChipLabel } from "./selection-label.js";

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

  it("returns an unrecognized selection verbatim instead of throwing", () => {
    expect(formatSelectionLabel("weird")).toBe("weird");
  });
});

describe("scoreChipLabel", () => {
  it("shows a compact score for the option buttons", () => {
    expect(scoreChipLabel("2-1")).toBe("2:1");
    expect(scoreChipLabel("3-3")).toBe("3:3");
    expect(scoreChipLabel("OTHER")).toBe("其它比分");
  });
});
