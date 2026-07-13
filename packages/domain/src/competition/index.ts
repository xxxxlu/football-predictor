export const PREMATCH_ODDS_MAX_AGE_MS = 10 * 60 * 1_000;

export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export type SyncState = "IDLE" | "SYNCING" | "PAUSED" | "FAILED";
export type DataState = "FRESH" | "SYNCING" | "STALE" | "PAUSED" | "UNAVAILABLE";
export type MarketStatus = "OPEN" | "DATA_UNAVAILABLE";
export type Selection = "HOME" | "DRAW" | "AWAY";

export interface FixtureSnapshot {
  id: string;
  supplier: "API_FOOTBALL";
  supplierFixtureId: number;
  competitionId: number;
  competitionName: string;
  season: number;
  kickoffAt: string;
  status: MatchStatus;
  homeTeam: { supplierTeamId: number; name: string };
  awayTeam: { supplierTeamId: number; name: string };
  version: string;
  dataAsOf: string;
  capturedAt: string;
  result?: { confirmed: boolean; homeScore: number | null; awayScore: number | null; version: string | null };
}

export interface OddsSnapshot {
  productMarketId: string;
  fixtureId: string;
  supplier: "API_FOOTBALL";
  supplierFixtureId: number;
  bookmakerId: number;
  bookmakerName: string;
  marketId: number;
  marketName: string;
  version: string;
  dataAsOf: string;
  capturedAt: string;
  outcomes: Array<{ selection: Selection; supplierLabel: string; decimalOdds: string }>;
}

export interface LiveSnapshot {
  fixtureId: string;
  supplierFixtureId: number;
  homeScore: number;
  awayScore: number;
  minute: number | null;
  dataAsOf: string;
  capturedAt: string;
  markets: Array<{
    supplierMarketId: number;
    name: string;
    values: Array<{ value: string; decimalOdds: string; suspended: boolean }>;
  }>;
}

export interface MarketAssessment {
  dataState: DataState;
  marketStatus: MarketStatus;
  canSubmit: boolean;
}

export interface MatchView extends Omit<FixtureSnapshot, "version" | "capturedAt"> {
  fixtureVersion: string;
  capabilities: { prematchPrediction: true; livePrediction: false };
  market: MarketAssessment & {
    id: string | null;
    odds: OddsSnapshot["outcomes"] | null;
    dataAsOf: string | null;
    trace: {
      supplier: "API_FOOTBALL";
      supplierFixtureId: number;
      bookmakerId: number | null;
      marketId: number | null;
      oddsVersion: string | null;
    };
  };
  live: LiveSnapshot | null;
}

export function assessMarketData(input: {
  now: Date;
  odds: OddsSnapshot | null;
  syncState: SyncState;
  sourceVerified: boolean;
  budgetAvailable: boolean;
  maxAgeMs?: number;
}): MarketAssessment {
  if (!input.sourceVerified || input.syncState === "FAILED" || input.odds === null) {
    return { dataState: "UNAVAILABLE", marketStatus: "DATA_UNAVAILABLE", canSubmit: false };
  }
  if (input.syncState === "PAUSED" || !input.budgetAvailable) {
    return { dataState: "PAUSED", marketStatus: "DATA_UNAVAILABLE", canSubmit: false };
  }
  if (input.syncState === "SYNCING") {
    return { dataState: "SYNCING", marketStatus: "DATA_UNAVAILABLE", canSubmit: false };
  }
  const age = input.now.getTime() - new Date(input.odds.dataAsOf).getTime();
  if (!Number.isFinite(age) || age < 0 || age > (input.maxAgeMs ?? PREMATCH_ODDS_MAX_AGE_MS)) {
    return { dataState: "STALE", marketStatus: "DATA_UNAVAILABLE", canSubmit: false };
  }
  return { dataState: "FRESH", marketStatus: "OPEN", canSubmit: true };
}

export function createMatchView(input: {
  now: Date;
  fixture: FixtureSnapshot;
  odds: OddsSnapshot | null;
  live?: LiveSnapshot | null;
  syncState: SyncState;
  sourceVerified: boolean;
  budgetAvailable: boolean;
}): MatchView {
  const { fixture, odds } = input;
  return {
    id: fixture.id,
    supplier: fixture.supplier,
    supplierFixtureId: fixture.supplierFixtureId,
    competitionId: fixture.competitionId,
    competitionName: fixture.competitionName,
    season: fixture.season,
    kickoffAt: new Date(fixture.kickoffAt).toISOString(),
    status: fixture.status,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    fixtureVersion: fixture.version,
    capabilities: { prematchPrediction: true, livePrediction: false },
    dataAsOf: fixture.dataAsOf,
    market: {
      ...assessMarketData(input),
      id: odds?.productMarketId ?? null,
      odds: odds?.outcomes ?? null,
      dataAsOf: odds?.dataAsOf ?? null,
      trace: {
        supplier: fixture.supplier,
        supplierFixtureId: fixture.supplierFixtureId,
        bookmakerId: odds?.bookmakerId ?? null,
        marketId: odds?.marketId ?? null,
        oddsVersion: odds?.version ?? null,
      },
    },
    live: input.live ?? null,
  };
}
