import type { SettlementOutcome } from "../settlement/settlement.js";
import type { F1ClassificationEntry, F1SessionResult } from "./types.js";
import type { F1Selection } from "./selections.js";

/** Outcome resolution for F1 selections against an official session classification
 *  (§12.5 结算规则). This is F1's own resolver — it must not route through the
 *  football correct-score resolver even for EXACT_PODIUM.
 *
 *  Rules implemented:
 *  - DNS: any ticket referencing a DNS driver refunds (CANCEL).
 *  - POLE / WINNER: classified P1 wins; everyone else loses.
 *  - PODIUM YES/NO: classified position ≤ 3 counts as on the podium.
 *  - EXACT_PODIUM: P1-P2-P3 must all match, in order.
 *  - H2H: classified finisher beats a non-finisher; between two non-finishers more
 *    laps wins; identical laps push (stake returned). DSQ ranks as a non-finisher. */

export class F1ResultError extends Error {
  constructor(readonly code: "UNKNOWN_DRIVER" | "INVALID_CLASSIFICATION") {
    super(code);
    this.name = "F1ResultError";
  }
}

function entryFor(result: F1SessionResult, driverCode: string): F1ClassificationEntry {
  const entry = result.classification.find((candidate) => candidate.driverCode === driverCode);
  if (!entry) throw new F1ResultError("UNKNOWN_DRIVER");
  return entry;
}

function classifiedPosition(entry: F1ClassificationEntry): number | null {
  return entry.status === "FINISHED" && entry.position !== null ? entry.position : null;
}

function podiumFinish(entry: F1ClassificationEntry): boolean {
  const position = classifiedPosition(entry);
  return position !== null && position <= 3;
}

/** Validates the shape of a classification before it is confirmed for settlement:
 *  unique drivers, unique classified positions starting at 1 with no gaps, and a
 *  classified P1 present unless the session produced no finishers. */
export function validateF1Classification(classification: F1ClassificationEntry[]): { ok: true } | { ok: false; reason: string } {
  if (classification.length === 0) return { ok: false, reason: "EMPTY" };
  const codes = new Set<string>();
  const positions: number[] = [];
  for (const entry of classification) {
    if (codes.has(entry.driverCode)) return { ok: false, reason: `DUPLICATE_DRIVER:${entry.driverCode}` };
    codes.add(entry.driverCode);
    if (entry.status === "FINISHED") {
      if (entry.position === null || !Number.isInteger(entry.position) || entry.position < 1) {
        return { ok: false, reason: `INVALID_POSITION:${entry.driverCode}` };
      }
      positions.push(entry.position);
    }
    if (!Number.isInteger(entry.lapsCompleted) || entry.lapsCompleted < 0) {
      return { ok: false, reason: `INVALID_LAPS:${entry.driverCode}` };
    }
  }
  positions.sort((a, b) => a - b);
  for (let index = 0; index < positions.length; index += 1) {
    if (positions[index] !== index + 1) return { ok: false, reason: "POSITION_GAP" };
  }
  return { ok: true };
}

function resolveHeadToHead(a: F1ClassificationEntry, b: F1ClassificationEntry): SettlementOutcome {
  const positionA = classifiedPosition(a);
  const positionB = classifiedPosition(b);
  if (positionA !== null && positionB !== null) return positionA < positionB ? "WIN" : "LOSS";
  if (positionA !== null) return "WIN";
  if (positionB !== null) return "LOSS";
  if (a.lapsCompleted !== b.lapsCompleted) return a.lapsCompleted > b.lapsCompleted ? "WIN" : "LOSS";
  return "PUSH";
}

/** Resolves one parsed selection to a settlement outcome. Throws F1ResultError when
 *  the classification does not cover a referenced driver. */
export function resolveF1Selection(selection: F1Selection, result: F1SessionResult): SettlementOutcome {
  switch (selection.kind) {
    case "POLE":
    case "WINNER": {
      const entry = entryFor(result, selection.driverCode);
      if (entry.status === "DNS") return "CANCEL";
      return classifiedPosition(entry) === 1 ? "WIN" : "LOSS";
    }
    case "PODIUM": {
      const entry = entryFor(result, selection.driverCode);
      if (entry.status === "DNS") return "CANCEL";
      return podiumFinish(entry) === selection.onPodium ? "WIN" : "LOSS";
    }
    case "EXACT_PODIUM": {
      const first = entryFor(result, selection.first);
      const second = entryFor(result, selection.second);
      const third = entryFor(result, selection.third);
      if ([first, second, third].some((entry) => entry.status === "DNS")) return "CANCEL";
      return classifiedPosition(first) === 1 && classifiedPosition(second) === 2 && classifiedPosition(third) === 3
        ? "WIN"
        : "LOSS";
    }
    case "H2H": {
      const driver = entryFor(result, selection.driverCode);
      const opponent = entryFor(result, selection.opponentCode);
      if (driver.status === "DNS" || opponent.status === "DNS") return "CANCEL";
      return resolveHeadToHead(driver, opponent);
    }
  }
}
