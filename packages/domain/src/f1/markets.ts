import type { F1SessionKind } from "./types.js";

/** F1 market kinds (§12.5 v1 市场). EXACT_PODIUM reuses the high-odds ticket and
 *  settlement plumbing but is its own market — it must never map onto the football
 *  CORRECT_SCORE abstraction. */
export type F1MarketKind = "POLE" | "WINNER" | "PODIUM" | "EXACT_PODIUM" | "H2H";

export const F1_MARKET_KINDS: readonly F1MarketKind[] = ["POLE", "WINNER", "PODIUM", "EXACT_PODIUM", "H2H"];

/** Synthetic supplier-market ids recorded on frozen legs. Football owns 1 (1X2) and 2
 *  (correct score); the F1 block starts at 101 so the kinds can never collide. */
export const F1_SUPPLIER_MARKET_IDS: Record<F1MarketKind, number> = {
  POLE: 101,
  WINNER: 102,
  PODIUM: 103,
  EXACT_PODIUM: 104,
  H2H: 105,
};

const KIND_BY_SUPPLIER_ID = new Map<number, F1MarketKind>(
  (Object.entries(F1_SUPPLIER_MARKET_IDS) as Array<[F1MarketKind, number]>).map(([kind, id]) => [id, kind]),
);

/** F1 kind for a leg's supplier market id, or null when the leg is not an F1 leg. */
export function f1MarketKindFromSupplierMarketId(supplierMarketId: number): F1MarketKind | null {
  return KIND_BY_SUPPLIER_ID.get(supplierMarketId) ?? null;
}

/** Provenance value recorded on F1 legs (no realtime supplier; admin enters results). */
export const F1_SUPPLIER = "F1_MANUAL";

/** Markets offered per session kind (§12.5): qualifying-type sessions price pole
 *  only; race-type sessions price the winner plus the exact-podium contest
 *  (领奖台之争 — pick P1/P2/P3 in order from the whole field). H2H (2026-07-25) and
 *  the yes/no PODIUM market (2026-07-25, merged into EXACT_PODIUM) were retired as
 *  offered markets — both stay in F1MarketKind/selection/settlement so existing
 *  tickets keep settling, but they are never offered and reject new submissions. */
export function f1MarketKindsForSession(kind: F1SessionKind): readonly F1MarketKind[] {
  return kind === "QUALIFYING" || kind === "SPRINT_QUALIFYING"
    ? ["POLE"]
    : ["WINNER", "EXACT_PODIUM"];
}

/** Canonical market id: `f1:<sessionId>:<kind>`. Stored in tickets.market_id. */
export function f1MarketId(sessionId: string, kind: F1MarketKind): string {
  return `f1:${sessionId}:${kind}`;
}

export interface ParsedF1MarketId {
  sessionId: string;
  kind: F1MarketKind;
}

/** Parses a canonical F1 market id; null when the id belongs to another sport. */
export function parseF1MarketId(marketId: string): ParsedF1MarketId | null {
  const match = /^f1:(.+):(POLE|WINNER|PODIUM|EXACT_PODIUM|H2H)$/.exec(marketId);
  const sessionId = match?.[1];
  const kind = match?.[2];
  if (!sessionId || !kind) return null;
  return { sessionId, kind: kind as F1MarketKind };
}

/** Canonical fixture id recorded on F1 tickets: `f1:<sessionId>`. */
export function f1FixtureId(sessionId: string): string {
  return `f1:${sessionId}`;
}

export function parseF1FixtureId(fixtureId: string): string | null {
  return /^f1:([^:]+)$/.exec(fixtureId)?.[1] ?? null;
}
