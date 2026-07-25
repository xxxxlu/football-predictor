export type RoomTier = "STANDARD" | "ADVANCED";
export type RoomSummary = { id: string; name: string; role: "member" | "room_owner"; memberCount?: number; tier?: RoomTier };
export type MatchState = "OPEN" | "PAUSED" | "CLOSED" | "DATA_UNAVAILABLE" | "FINISHED";
export type OddsSelection = "HOME" | "DRAW" | "AWAY";
export type CorrectScoreOutcome = { selection: string; decimalOdds: string };
export type MatchView = {
  id: string; competitionName: string; homeTeam: string; awayTeam: string; kickoffAt: string; state: MatchState;
  dataAsOf?: string; stale?: boolean; supplierStatus?: string;
  market?: { id: string | number; version: string; home: string; draw: string; away: string };
  correctScore?: { id: string | number; version: string; outcomes: CorrectScoreOutcome[] };
  result?: { homeScore: number; awayScore: number };
};
export type BalanceView = { availablePoints: string; frozenPoints: string; correctionDebt?: string };
export type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> };
export type ApiFailure = { error?: { code?: string; message?: string; correlationId?: string } };
export type FreshnessMeta = {
  lastCapturedAt: string | null;
  nextKickoffAt: string | null;
  nextKickoffCompetition: string | null;
  upcomingCount: number;
  liveCount: number;
  finishedRecentCount: number;
};

// meta.freshness 载荷 → FreshnessMeta；缺失或形状不对时返回 null，不猜测任何数据。
export function normalizeFreshness(value: unknown): FreshnessMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const isoOrNull = (candidate: unknown): string | null =>
    typeof candidate === "string" && Number.isFinite(new Date(candidate).getTime()) ? candidate : null;
  const count = (candidate: unknown): number =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : 0;
  return {
    lastCapturedAt: isoOrNull(raw.lastCapturedAt),
    nextKickoffAt: isoOrNull(raw.nextKickoffAt),
    nextKickoffCompetition: typeof raw.nextKickoffCompetition === "string" && raw.nextKickoffCompetition.trim() ? raw.nextKickoffCompetition : null,
    upcomingCount: count(raw.upcomingCount),
    liveCount: count(raw.liveCount),
    finishedRecentCount: count(raw.finishedRecentCount),
  };
}

type ProductMarket = { id?: string | null; marketStatus?: string; dataState?: string; dataAsOf?: string; odds?: unknown; trace?: { marketId?: string | number | null; oddsVersion?: string | null } };
type ProductMatch = {
  id?: string; competitionName?: string; kickoffAt?: string; status?: string; dataAsOf?: string;
  homeTeam?: string | { name?: string }; awayTeam?: string | { name?: string };
  result?: { confirmed?: boolean; homeScore?: number | null; awayScore?: number | null; version?: string | null };
  market?: ProductMarket;
  correctScoreMarket?: ProductMarket | null;
};

function normalizedOdds(value: unknown): Array<{ selection?: string; decimalOdds?: string }> {
  let candidate = value;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); }
    catch { return []; }
  }
  return Array.isArray(candidate) ? candidate.filter((item): item is { selection?: string; decimalOdds?: string } => Boolean(item) && typeof item === "object") : [];
}

// GET /api/v1/matches/[matchId] 的响应体 → MatchView；载荷缺失或无法归一化时返回 null。
export function matchViewFromDetailPayload(payload: unknown): MatchView | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return normalizeMatch(data as ProductMatch);
}

export function normalizeMatch(value: ProductMatch): MatchView | null {
  if (!value.id || !value.kickoffAt) return null;
  const team = (input: ProductMatch["homeTeam"]) => typeof input === "string" ? input : input?.name || "待定";
  const odds = normalizedOdds(value.market?.odds);
  const outcome = (selection: OddsSelection) => odds.find(item => item.selection === selection)?.decimalOdds;
  const status = value.status;
  const dataState = value.market?.dataState;
  const state: MatchState = status === "FINISHED" ? "FINISHED" : ["CANCELLED", "POSTPONED", "LIVE"].includes(status || "") ? "CLOSED" : value.market?.marketStatus === "OPEN" ? "OPEN" : dataState === "PAUSED" || dataState === "SYNCING" ? "PAUSED" : "DATA_UNAVAILABLE";
  const home = outcome("HOME"), draw = outcome("DRAW"), away = outcome("AWAY");
  const validScore = (score: number | null | undefined): score is number => typeof score === "number" && Number.isInteger(score) && score >= 0;
  const result = status === "FINISHED" && value.result?.confirmed && validScore(value.result.homeScore) && validScore(value.result.awayScore)
    ? { homeScore: value.result.homeScore, awayScore: value.result.awayScore }
    : undefined;
  const cs = value.correctScoreMarket;
  const csOutcomes = normalizedOdds(cs?.odds)
    .filter((item): item is { selection: string; decimalOdds: string } => typeof item.selection === "string" && typeof item.decimalOdds === "string")
    .map((item) => ({ selection: item.selection, decimalOdds: item.decimalOdds }));
  const correctScore = cs && cs.marketStatus === "OPEN" && cs.id && cs.trace?.oddsVersion && csOutcomes.length
    ? { id: cs.id, version: cs.trace.oddsVersion, outcomes: csOutcomes }
    : undefined;
  return { id: value.id, competitionName: value.competitionName?.trim() || "未标注联赛", kickoffAt: value.kickoffAt, homeTeam: team(value.homeTeam), awayTeam: team(value.awayTeam), state, dataAsOf: value.market?.dataAsOf || value.dataAsOf, stale: dataState === "STALE", supplierStatus: dataState, market: home && draw && away && value.market?.id && value.market.trace?.oddsVersion ? { id: value.market.id, version: value.market.trace.oddsVersion, home, draw, away } : undefined, correctScore, result };
}
