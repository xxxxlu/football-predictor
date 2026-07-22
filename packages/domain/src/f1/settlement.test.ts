import { describe, expect, it } from "vitest";
import { outcomeForF1Candidate, type F1SettlementCandidate } from "./settlement.js";
import { F1ResultError } from "./results.js";
import type { F1ClassificationEntry } from "./types.js";

const classification: F1ClassificationEntry[] = [
  { driverCode: "NOR", position: 1, status: "FINISHED", lapsCompleted: 52 },
  { driverCode: "VER", position: 2, status: "FINISHED", lapsCompleted: 52 },
  { driverCode: "PIA", position: 3, status: "FINISHED", lapsCompleted: 52 },
  { driverCode: "LEC", position: null, status: "DNF", lapsCompleted: 20 },
  { driverCode: "RUS", position: null, status: "DNF", lapsCompleted: 20 },
  { driverCode: "STR", position: null, status: "DNS", lapsCompleted: 0 },
];

const candidate = (overrides: Partial<F1SettlementCandidate> = {}): F1SettlementCandidate => ({
  ticketId: "ticket-1",
  settlementVersion: "1",
  activeSettlementVersion: null,
  sessionState: "FINISHED",
  resultConfirmed: true,
  classification,
  selection: "DRV:NOR",
  supplierMarketId: 102,
  ...overrides,
});

describe("outcomeForF1Candidate", () => {
  it("derives winner, podium, exact podium and H2H outcomes from the classification", () => {
    expect(outcomeForF1Candidate(candidate())).toBe("WIN");
    expect(outcomeForF1Candidate(candidate({ selection: "DRV:VER" }))).toBe("LOSS");
    expect(outcomeForF1Candidate(candidate({ selection: "DRV:NOR", supplierMarketId: 101 }))).toBe("WIN");
    expect(outcomeForF1Candidate(candidate({ selection: "PODIUM:PIA:YES", supplierMarketId: 103 }))).toBe("WIN");
    expect(outcomeForF1Candidate(candidate({ selection: "POD3:NOR-VER-PIA", supplierMarketId: 104 }))).toBe("WIN");
    expect(outcomeForF1Candidate(candidate({ selection: "POD3:VER-NOR-PIA", supplierMarketId: 104 }))).toBe("LOSS");
    expect(outcomeForF1Candidate(candidate({ selection: "H2H:LEC>RUS", supplierMarketId: 105 }))).toBe("PUSH");
  });

  it("refunds a cancelled session and DNS-affected selections", () => {
    expect(outcomeForF1Candidate(candidate({ sessionState: "CANCELLED", classification: null }))).toBe("CANCEL");
    expect(outcomeForF1Candidate(candidate({ selection: "DRV:STR" }))).toBe("CANCEL");
  });

  it("refuses to settle malformed legs or unconfirmed sessions instead of guessing", () => {
    expect(() => outcomeForF1Candidate(candidate({ sessionState: "UPCOMING" }))).toThrow(F1ResultError);
    expect(() => outcomeForF1Candidate(candidate({ classification: null }))).toThrow(F1ResultError);
    expect(() => outcomeForF1Candidate(candidate({ supplierMarketId: 1 }))).toThrow(F1ResultError);
    expect(() => outcomeForF1Candidate(candidate({ selection: "HOME" }))).toThrow(F1ResultError);
    expect(() => outcomeForF1Candidate(candidate({ selection: "DRV:ZZZ" }))).toThrow(F1ResultError);
  });
});
