import {
  computeMatchOddsMovements,
  type LiveFeedItem,
  type LiveMatchEvent,
  type OddsMovementMap,
} from "@pulse/domain";
import type { MatchView } from "./types";

interface CachedMatchState {
  score: { home: number; away: number };
  odds: Record<string, string>;
  lastEventId?: string;
}

export class LiveFeedManager {
  private readonly stateMap = new Map<string, CachedMatchState>();

  /**
   * Transforms raw MatchViews from the product cache into rich LiveFeedItems
   * with directional odds movement and goal event detection.
   */
  processMatches(matches: MatchView[], now: Date = new Date()): LiveFeedItem[] {
    const items: LiveFeedItem[] = [];

    for (const match of matches) {
      const matchId = match.id;
      const m = match as unknown as {
        status?: LiveFeedItem["status"];
        market?: { odds?: Array<{ selection?: string; decimalOdds?: string | number }> };
        live?: { minute?: number; homeScore?: number; awayScore?: number };
      };
      const status = m.status ?? (match.state === "FINISHED" ? "FINISHED" : "SCHEDULED");

      // Current 1X2 odds map
      const currentOdds: Record<string, string> = {};
      if (Array.isArray(m.market?.odds)) {
        for (const outcome of m.market.odds) {
          if (outcome?.selection && outcome?.decimalOdds) {
            currentOdds[outcome.selection] = String(outcome.decimalOdds);
          }
        }
      } else if (match.market?.home && match.market?.draw && match.market?.away) {
        currentOdds["HOME"] = String(match.market.home);
        currentOdds["DRAW"] = String(match.market.draw);
        currentOdds["AWAY"] = String(match.market.away);
      }

      // Current live score
      const currentScore = {
        home: m.live?.homeScore ?? match.result?.homeScore ?? 0,
        away: m.live?.awayScore ?? match.result?.awayScore ?? 0,
      };

      const homeName = typeof match.homeTeam === "string" ? match.homeTeam : "主队";
      const awayName = typeof match.awayTeam === "string" ? match.awayTeam : "客队";

      const prevState = this.stateMap.get(matchId);
      let oddsMovement: OddsMovementMap = {};
      const recentEvents: LiveMatchEvent[] = [];

      if (prevState) {
        // Calculate odds movement trend
        oddsMovement = computeMatchOddsMovements(currentOdds, prevState.odds);

        // Detect score alteration (Goal event)
        if (currentScore.home > prevState.score.home) {
          recentEvents.push({
            id: `ev-goal-h-${matchId}-${currentScore.home}-${currentScore.away}`,
            type: "GOAL",
            team: "HOME",
            minute: m.live?.minute ?? 45,
            description: `${homeName} 进球!`,
          });
        }
        if (currentScore.away > prevState.score.away) {
          recentEvents.push({
            id: `ev-goal-a-${matchId}-${currentScore.home}-${currentScore.away}`,
            type: "GOAL",
            team: "AWAY",
            minute: m.live?.minute ?? 45,
            description: `${awayName} 进球!`,
          });
        }
      }

      // Update cached memory state for next tick
      this.stateMap.set(matchId, {
        score: currentScore,
        odds: currentOdds,
      });

      items.push({
        matchId,
        status,
        minute: m.live?.minute ?? undefined,
        score: currentScore,
        odds: currentOdds,
        oddsMovement,
        recentEvents,
        updatedAt: now.toISOString(),
      });
    }

    return items;
  }
}

declare global {
  var __pulseLiveFeedManager: LiveFeedManager | undefined;
}

export function getLiveFeedManager(): LiveFeedManager {
  if (globalThis.__pulseLiveFeedManager) return globalThis.__pulseLiveFeedManager;
  const manager = new LiveFeedManager();
  globalThis.__pulseLiveFeedManager = manager;
  return manager;
}
