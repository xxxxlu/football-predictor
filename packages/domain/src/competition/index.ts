export const PREMATCH_ODDS_MAX_AGE_MS = 10 * 60 * 1_000;
export const THE_ODDS_API_MAX_AGE_MS = 13 * 60 * 60 * 1_000;

export type FixtureSupplier = "API_FOOTBALL" | "OPENLIGADB";
export type MarketSupplier = "API_FOOTBALL" | "THE_ODDS_API" | "PLATFORM";
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export type SyncState = "IDLE" | "SYNCING" | "PAUSED" | "FAILED";
export type DataState = "FRESH" | "SYNCING" | "STALE" | "PAUSED" | "UNAVAILABLE";
export type MarketStatus = "OPEN" | "DATA_UNAVAILABLE";
export type Selection = "HOME" | "DRAW" | "AWAY";

export interface FixtureSnapshot {
  id: string;
  supplier: FixtureSupplier;
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
  supplier: MarketSupplier;
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
      supplier: FixtureSupplier | MarketSupplier;
      supplierFixtureId: number;
      bookmakerId: number | null;
      marketId: number | null;
      oddsVersion: string | null;
    };
  };
  live: LiveSnapshot | null;
}

const COMPETITION_NAMES: Readonly<Record<string, string>> = {
  "FIFA World Cup": "世界杯", "World Cup": "世界杯", "WM 2026": "世界杯",
  "UEFA Champions League": "欧冠", "Champions League": "欧冠",
  "Premier League": "英超", "La Liga": "西甲", "Primera Division": "西甲",
  "Serie A": "意甲", Bundesliga: "德甲", "Ligue 1": "法甲",
  MLS: "美职联", "Major League Soccer": "美职联",
};

const TEAM_NAMES_BY_CODE: Readonly<Record<string, string>> = {
  ARG: "阿根廷", AUS: "澳大利亚", AUT: "奥地利", BEL: "比利时", BIH: "波黑", BRA: "巴西",
  CAN: "加拿大", CHE: "瑞士", CIV: "科特迪瓦", CMR: "喀麦隆", COD: "民主刚果", COL: "哥伦比亚",
  CPV: "佛得角", CRO: "克罗地亚", HRV: "克罗地亚", CUW: "库拉索", CZE: "捷克", DEN: "丹麦",
  ECU: "厄瓜多尔", EGY: "埃及", ENG: "英格兰", ESP: "西班牙", FRA: "法国", GER: "德国",
  GHA: "加纳", HAI: "海地", HTI: "海地", IRN: "伊朗", IRQ: "伊拉克", ITA: "意大利",
  JPN: "日本", JOR: "约旦", KOR: "韩国", MAR: "摩洛哥", MEX: "墨西哥", NED: "荷兰",
  NLD: "荷兰", NOR: "挪威", NZL: "新西兰", PAN: "巴拿马", PAR: "巴拉圭", POL: "波兰",
  POR: "葡萄牙", PRT: "葡萄牙", QAT: "卡塔尔", RSA: "南非", SAU: "沙特阿拉伯", SCO: "苏格兰",
  SCT: "苏格兰", SEN: "塞内加尔", SRB: "塞尔维亚", SUI: "瑞士", SWE: "瑞典", TUN: "突尼斯",
  TUR: "土耳其", UKR: "乌克兰", URU: "乌拉圭", URY: "乌拉圭", USA: "美国", UZB: "乌兹别克斯坦",
};

const TEAM_NAMES: Readonly<Record<string, string>> = {
  Argentina: "阿根廷", Australia: "澳大利亚", Belgium: "比利时", Brazil: "巴西", Canada: "加拿大",
  Colombia: "哥伦比亚", Croatia: "克罗地亚", Ecuador: "厄瓜多尔", England: "英格兰", France: "法国",
  Germany: "德国", Japan: "日本", Mexico: "墨西哥", Morocco: "摩洛哥", Netherlands: "荷兰",
  Portugal: "葡萄牙", Senegal: "塞内加尔", Spain: "西班牙", Switzerland: "瑞士", Uruguay: "乌拉圭",
  "United States": "美国",
};

export function localizeCompetitionName(name: string): string { return COMPETITION_NAMES[name.trim()] ?? name.trim(); }
export function localizeTeamName(name: string, code?: string): string {
  const normalizedCode = code?.trim().toUpperCase();
  return (normalizedCode ? TEAM_NAMES_BY_CODE[normalizedCode] : undefined) ?? TEAM_NAMES[name.trim()] ?? name.trim();
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
  if (input.odds.supplier === "PLATFORM") {
    return { dataState: "FRESH", marketStatus: "OPEN", canSubmit: true };
  }
  const age = input.now.getTime() - new Date(input.odds.dataAsOf).getTime();
  const providerMaxAgeMs = input.odds.supplier === "THE_ODDS_API" ? THE_ODDS_API_MAX_AGE_MS : PREMATCH_ODDS_MAX_AGE_MS;
  if (!Number.isFinite(age) || age < 0 || age > (input.maxAgeMs ?? providerMaxAgeMs)) {
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
    competitionName: localizeCompetitionName(fixture.competitionName),
    season: fixture.season,
    kickoffAt: new Date(fixture.kickoffAt).toISOString(),
    status: fixture.status,
    homeTeam: { ...fixture.homeTeam, name: localizeTeamName(fixture.homeTeam.name) },
    awayTeam: { ...fixture.awayTeam, name: localizeTeamName(fixture.awayTeam.name) },
    fixtureVersion: fixture.version,
    capabilities: { prematchPrediction: true, livePrediction: false },
    dataAsOf: fixture.dataAsOf,
    market: {
      ...assessMarketData(input),
      id: odds?.productMarketId ?? null,
      odds: odds?.outcomes ?? null,
      dataAsOf: odds?.dataAsOf ?? null,
      trace: {
        supplier: odds?.supplier ?? fixture.supplier,
        supplierFixtureId: fixture.supplierFixtureId,
        bookmakerId: odds?.bookmakerId ?? null,
        marketId: odds?.marketId ?? null,
        oddsVersion: odds?.version ?? null,
      },
    },
    live: input.live ?? null,
  };
}
