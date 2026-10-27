export type LiveOddsTrend = "UP" | "DOWN" | "FLAT";

export interface OddsMovementMap {
  HOME?: LiveOddsTrend;
  DRAW?: LiveOddsTrend;
  AWAY?: LiveOddsTrend;
  [key: string]: LiveOddsTrend | undefined;
}

export interface LiveMatchEvent {
  id: string;
  type: "GOAL" | "RED_CARD" | "YELLOW_CARD" | "PERIOD_START" | "VAR";
  minute: number;
  team: "HOME" | "AWAY";
  playerName?: string;
  description?: string;
}

export interface LiveFeedItem {
  matchId: string;
  status: "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
  minute?: number;
  period?: string; // "1H" | "HT" | "2H" | "ET" | "FT"
  score: {
    home: number;
    away: number;
  };
  odds: Record<string, string>;
  oddsMovement: OddsMovementMap;
  recentEvents: LiveMatchEvent[];
  updatedAt: string;
}

/**
 * Compares current odds string to previous odds string and returns trend direction.
 */
export function computeOddsTrend(currentOdds: string, previousOdds?: string): LiveOddsTrend {
  if (!previousOdds) return "FLAT";
  const cur = parseFloat(currentOdds);
  const prev = parseFloat(previousOdds);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return "FLAT";

  // Differences smaller than 0.005 are treated as noise/flat
  const diff = Math.round((cur - prev) * 100) / 100;
  if (diff > 0) return "UP";
  if (diff < 0) return "DOWN";
  return "FLAT";
}

/**
 * Computes odds movement map across all selections (HOME, DRAW, AWAY, etc.)
 */
export function computeMatchOddsMovements(
  current: Record<string, string>,
  previous?: Record<string, string>,
): OddsMovementMap {
  const result: OddsMovementMap = {};
  if (!previous) return result;

  for (const [key, value] of Object.entries(current)) {
    if (previous[key] !== undefined) {
      result[key] = computeOddsTrend(value, previous[key]);
    }
  }

  return result;
}

/**
 * Validates whether an event qualifies as a score-altering event (requiring score flash effect).
 */
export function isScoreAlteringEvent(event: LiveMatchEvent): boolean {
  return event.type === "GOAL";
}
