import type { F1MarketKind } from "./markets.js";

/** F1 selection string encodings frozen onto prediction legs.
 *
 *  POLE / WINNER   → `DRV:NOR`
 *  PODIUM          → `PODIUM:NOR:YES` | `PODIUM:NOR:NO`
 *  EXACT_PODIUM    → `POD3:NOR-VER-PIA` (P1-P2-P3, order matters)
 *  H2H             → `H2H:NOR>VER` (NOR classified ahead of VER)
 *
 *  Driver codes are FIA-style 2–4 uppercase alphanumerics. The DB check constraint
 *  mirrors these shapes as a guardrail; the exact candidate set is enforced here. */

const DRIVER_CODE = /^[A-Z][A-Z0-9]{1,3}$/;

export type F1DriverSelection = { kind: "POLE" | "WINNER"; driverCode: string };
export type F1PodiumSelection = { kind: "PODIUM"; driverCode: string; onPodium: boolean };
export type F1ExactPodiumSelection = { kind: "EXACT_PODIUM"; first: string; second: string; third: string };
export type F1HeadToHeadSelection = { kind: "H2H"; driverCode: string; opponentCode: string };

export type F1Selection = F1DriverSelection | F1PodiumSelection | F1ExactPodiumSelection | F1HeadToHeadSelection;

export function isValidDriverCode(code: string): boolean {
  return DRIVER_CODE.test(code);
}

export function encodeF1Selection(selection: F1Selection): string {
  switch (selection.kind) {
    case "POLE":
    case "WINNER":
      return `DRV:${selection.driverCode}`;
    case "PODIUM":
      return `PODIUM:${selection.driverCode}:${selection.onPodium ? "YES" : "NO"}`;
    case "EXACT_PODIUM":
      return `POD3:${selection.first}-${selection.second}-${selection.third}`;
    case "H2H":
      return `H2H:${selection.driverCode}>${selection.opponentCode}`;
  }
}

/** Parses an encoded selection for the given market kind; null when malformed or
 *  inconsistent with the market (e.g. a PODIUM string on a WINNER market). */
export function parseF1Selection(marketKind: F1MarketKind, encoded: string): F1Selection | null {
  switch (marketKind) {
    case "POLE":
    case "WINNER": {
      const driverCode = /^DRV:([A-Z0-9]{2,4})$/.exec(encoded)?.[1];
      if (!driverCode || !isValidDriverCode(driverCode)) return null;
      return { kind: marketKind, driverCode };
    }
    case "PODIUM": {
      const match = /^PODIUM:([A-Z0-9]{2,4}):(YES|NO)$/.exec(encoded);
      const driverCode = match?.[1];
      if (!driverCode || !isValidDriverCode(driverCode)) return null;
      return { kind: "PODIUM", driverCode, onPodium: match?.[2] === "YES" };
    }
    case "EXACT_PODIUM": {
      const match = /^POD3:([A-Z0-9]{2,4})-([A-Z0-9]{2,4})-([A-Z0-9]{2,4})$/.exec(encoded);
      const [first, second, third] = [match?.[1], match?.[2], match?.[3]];
      if (!first || !second || !third) return null;
      if (![first, second, third].every(isValidDriverCode)) return null;
      if (new Set([first, second, third]).size !== 3) return null;
      return { kind: "EXACT_PODIUM", first, second, third };
    }
    case "H2H": {
      const match = /^H2H:([A-Z0-9]{2,4})>([A-Z0-9]{2,4})$/.exec(encoded);
      const [driverCode, opponentCode] = [match?.[1], match?.[2]];
      if (!driverCode || !opponentCode) return null;
      if (!isValidDriverCode(driverCode) || !isValidDriverCode(opponentCode)) return null;
      if (driverCode === opponentCode) return null;
      return { kind: "H2H", driverCode, opponentCode };
    }
  }
}

/** Every driver code referenced by a selection (for entry-list validation). */
export function driversInSelection(selection: F1Selection): string[] {
  switch (selection.kind) {
    case "POLE":
    case "WINNER":
      return [selection.driverCode];
    case "PODIUM":
      return [selection.driverCode];
    case "EXACT_PODIUM":
      return [selection.first, selection.second, selection.third];
    case "H2H":
      return [selection.driverCode, selection.opponentCode];
  }
}

/** True when every driver referenced by the selection appears in the entry list. */
export function selectionCoveredByEntryList(selection: F1Selection, entryList: ReadonlySet<string>): boolean {
  return driversInSelection(selection).every((code) => entryList.has(code));
}
