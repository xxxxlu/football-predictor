import { describe, expect, it } from "vitest";
import {
  encodeF1Selection,
  parseF1Selection,
  driversInSelection,
  selectionCoveredByEntryList,
} from "./selections.js";
import { F1_2026_DRIVER_CODES } from "./season-2026.js";

describe("F1 selection codec", () => {
  it("round-trips every selection kind", () => {
    const cases = [
      { kind: "POLE", driverCode: "NOR" },
      { kind: "WINNER", driverCode: "VER" },
      { kind: "PODIUM", driverCode: "HAM", onPodium: true },
      { kind: "PODIUM", driverCode: "HAM", onPodium: false },
      { kind: "EXACT_PODIUM", first: "NOR", second: "VER", third: "PIA" },
      { kind: "H2H", driverCode: "NOR", opponentCode: "VER" },
    ] as const;
    for (const selection of cases) {
      const encoded = encodeF1Selection(selection);
      expect(parseF1Selection(selection.kind, encoded)).toEqual(selection);
    }
  });

  it("encodes to the documented string grammar", () => {
    expect(encodeF1Selection({ kind: "WINNER", driverCode: "NOR" })).toBe("DRV:NOR");
    expect(encodeF1Selection({ kind: "PODIUM", driverCode: "HAM", onPodium: true })).toBe("PODIUM:HAM:YES");
    expect(encodeF1Selection({ kind: "EXACT_PODIUM", first: "NOR", second: "VER", third: "PIA" })).toBe("POD3:NOR-VER-PIA");
    expect(encodeF1Selection({ kind: "H2H", driverCode: "NOR", opponentCode: "VER" })).toBe("H2H:NOR>VER");
  });

  it("rejects malformed and cross-market strings", () => {
    expect(parseF1Selection("WINNER", "NOR")).toBeNull();
    expect(parseF1Selection("WINNER", "PODIUM:NOR:YES")).toBeNull();
    expect(parseF1Selection("PODIUM", "PODIUM:NOR:MAYBE")).toBeNull();
    expect(parseF1Selection("EXACT_PODIUM", "POD3:NOR-VER")).toBeNull();
    expect(parseF1Selection("H2H", "H2H:NOR>NOR")).toBeNull();
    expect(parseF1Selection("WINNER", "DRV:nor")).toBeNull();
    expect(parseF1Selection("WINNER", "DRV:N")).toBeNull();
  });

  it("rejects duplicate drivers in an exact podium", () => {
    expect(parseF1Selection("EXACT_PODIUM", "POD3:NOR-NOR-PIA")).toBeNull();
  });

  it("collects referenced drivers and validates against the entry list", () => {
    const selection = parseF1Selection("EXACT_PODIUM", "POD3:NOR-VER-PIA");
    expect(selection).not.toBeNull();
    expect(driversInSelection(selection!)).toEqual(["NOR", "VER", "PIA"]);
    expect(selectionCoveredByEntryList(selection!, F1_2026_DRIVER_CODES)).toBe(true);
    const unknown = parseF1Selection("H2H", "H2H:NOR>ZZZ");
    expect(unknown).not.toBeNull();
    expect(selectionCoveredByEntryList(unknown!, F1_2026_DRIVER_CODES)).toBe(false);
  });
});
