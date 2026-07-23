import { describe, expect, it } from "vitest";
import { resolveF1Selection, validateF1Classification, F1ResultError } from "./results.js";
import { parseF1Selection } from "./selections.js";
import type { F1ClassificationEntry, F1SessionResult } from "./types.js";

function entry(driverCode: string, position: number | null, status: F1ClassificationEntry["status"], lapsCompleted = 52): F1ClassificationEntry {
  return { driverCode, position, status, lapsCompleted };
}

const result: F1SessionResult = {
  sessionId: "session-1",
  version: 1,
  classification: [
    entry("NOR", 1, "FINISHED"),
    entry("VER", 2, "FINISHED"),
    entry("PIA", 3, "FINISHED"),
    entry("HAM", 4, "FINISHED"),
    entry("LEC", null, "DNF", 30),
    entry("RUS", null, "DNF", 12),
    entry("ALO", null, "DNF", 12),
    entry("STR", null, "DNS", 0),
    entry("OCO", null, "DSQ", 52),
  ],
};

function sel(kind: Parameters<typeof parseF1Selection>[0], encoded: string) {
  const parsed = parseF1Selection(kind, encoded);
  if (!parsed) throw new Error(`bad selection ${encoded}`);
  return parsed;
}

describe("resolveF1Selection", () => {
  it("settles winner and pole on classified P1", () => {
    expect(resolveF1Selection(sel("WINNER", "DRV:NOR"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("WINNER", "DRV:VER"), result)).toBe("LOSS");
    expect(resolveF1Selection(sel("POLE", "DRV:NOR"), result)).toBe("WIN");
  });

  it("settles podium yes/no on classified top three", () => {
    expect(resolveF1Selection(sel("PODIUM", "PODIUM:PIA:YES"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("PODIUM", "PODIUM:HAM:YES"), result)).toBe("LOSS");
    expect(resolveF1Selection(sel("PODIUM", "PODIUM:HAM:NO"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("PODIUM", "PODIUM:LEC:YES"), result)).toBe("LOSS");
  });

  it("settles exact podium only on a full ordered match", () => {
    expect(resolveF1Selection(sel("EXACT_PODIUM", "POD3:NOR-VER-PIA"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("EXACT_PODIUM", "POD3:VER-NOR-PIA"), result)).toBe("LOSS");
    expect(resolveF1Selection(sel("EXACT_PODIUM", "POD3:NOR-VER-HAM"), result)).toBe("LOSS");
  });

  it("refunds any selection referencing a DNS driver (§12.5)", () => {
    expect(resolveF1Selection(sel("WINNER", "DRV:STR"), result)).toBe("CANCEL");
    expect(resolveF1Selection(sel("PODIUM", "PODIUM:STR:NO"), result)).toBe("CANCEL");
    expect(resolveF1Selection(sel("EXACT_PODIUM", "POD3:NOR-VER-STR"), result)).toBe("CANCEL");
    expect(resolveF1Selection(sel("H2H", "H2H:NOR>STR"), result)).toBe("CANCEL");
  });

  it("settles head-to-head by classification, finisher over DNF, laps between DNFs", () => {
    expect(resolveF1Selection(sel("H2H", "H2H:NOR>VER"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("H2H", "H2H:VER>NOR"), result)).toBe("LOSS");
    expect(resolveF1Selection(sel("H2H", "H2H:HAM>LEC"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("H2H", "H2H:LEC>HAM"), result)).toBe("LOSS");
    expect(resolveF1Selection(sel("H2H", "H2H:LEC>RUS"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("H2H", "H2H:RUS>ALO"), result)).toBe("PUSH");
  });

  it("ranks a disqualified driver as a non-finisher", () => {
    expect(resolveF1Selection(sel("H2H", "H2H:HAM>OCO"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("H2H", "H2H:OCO>LEC"), result)).toBe("WIN");
    expect(resolveF1Selection(sel("PODIUM", "PODIUM:OCO:YES"), result)).toBe("LOSS");
  });

  it("throws on drivers missing from the classification", () => {
    expect(() => resolveF1Selection(sel("WINNER", "DRV:ZZZ"), result)).toThrow(F1ResultError);
  });
});

describe("validateF1Classification", () => {
  it("accepts the reference classification", () => {
    expect(validateF1Classification(result.classification)).toEqual({ ok: true });
  });

  it("rejects duplicate drivers, position gaps and negative laps", () => {
    expect(validateF1Classification([entry("NOR", 1, "FINISHED"), entry("NOR", 2, "FINISHED")]).ok).toBe(false);
    expect(validateF1Classification([entry("NOR", 1, "FINISHED"), entry("VER", 3, "FINISHED")]).ok).toBe(false);
    expect(validateF1Classification([entry("NOR", 1, "FINISHED"), entry("VER", null, "DNF", -1)]).ok).toBe(false);
    expect(validateF1Classification([]).ok).toBe(false);
  });

  it("rejects finished entries without a position", () => {
    expect(validateF1Classification([entry("NOR", null, "FINISHED")]).ok).toBe(false);
  });
});
