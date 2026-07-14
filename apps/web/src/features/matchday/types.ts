export type RoomSummary = { id: string; name: string; role: "member" | "room_owner"; memberCount?: number };
export type MatchState = "OPEN" | "PAUSED" | "CLOSED" | "DATA_UNAVAILABLE" | "FINISHED";
export type OddsSelection = "HOME" | "DRAW" | "AWAY";
export type MatchView = {
  id: string; competitionName: string; homeTeam: string; awayTeam: string; kickoffAt: string; state: MatchState;
  dataAsOf?: string; stale?: boolean; supplierStatus?: string;
  market?: { id: string | number; version: string; home: string; draw: string; away: string };
};
export type BalanceView = { availablePoints: string; frozenPoints: string; correctionDebt?: string };
export type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> };
export type ApiFailure = { error?: { code?: string; message?: string; correlationId?: string } };

type ProductMatch = {
  id?: string; competitionName?: string; kickoffAt?: string; status?: string; dataAsOf?: string;
  homeTeam?: string | { name?: string }; awayTeam?: string | { name?: string };
  market?: { id?: string | null; marketStatus?: string; dataState?: string; dataAsOf?: string; odds?: Array<{ selection?: string; decimalOdds?: string }>; trace?: { marketId?: string | number | null; oddsVersion?: string | null } };
};

export function normalizeMatch(value: ProductMatch): MatchView | null {
  if (!value.id || !value.kickoffAt) return null;
  const team = (input: ProductMatch["homeTeam"]) => typeof input === "string" ? input : input?.name || "待定";
  const outcome = (selection: OddsSelection) => value.market?.odds?.find(item => item.selection === selection)?.decimalOdds;
  const status = value.status;
  const dataState = value.market?.dataState;
  const state: MatchState = status === "FINISHED" ? "FINISHED" : ["CANCELLED", "POSTPONED", "LIVE"].includes(status || "") ? "CLOSED" : value.market?.marketStatus === "OPEN" ? "OPEN" : dataState === "PAUSED" || dataState === "SYNCING" ? "PAUSED" : "DATA_UNAVAILABLE";
  const home = outcome("HOME"), draw = outcome("DRAW"), away = outcome("AWAY");
  return { id: value.id, competitionName: value.competitionName?.trim() || "未标注联赛", kickoffAt: value.kickoffAt, homeTeam: team(value.homeTeam), awayTeam: team(value.awayTeam), state, dataAsOf: value.market?.dataAsOf || value.dataAsOf, stale: dataState === "STALE", supplierStatus: dataState, market: home && draw && away && value.market?.id && value.market.trace?.oddsVersion ? { id: value.market.id, version: value.market.trace.oddsVersion, home, draw, away } : undefined };
}
