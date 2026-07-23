// Client view types + defensive normalizers for the F1 read API
// (/api/v1/f1/weekends and /api/v1/f1/sessions/[sessionId]).

export type F1SessionKind = "QUALIFYING" | "SPRINT_QUALIFYING" | "SPRINT" | "GRAND_PRIX";
export type F1SessionState = "UPCOMING" | "LOCKED" | "FINISHED" | "CANCELLED";
export type F1MarketKind = "POLE" | "WINNER" | "PODIUM" | "EXACT_PODIUM" | "H2H";

export const SESSION_KIND_LABELS: Readonly<Record<F1SessionKind, string>> = {
  QUALIFYING: "排位赛",
  SPRINT_QUALIFYING: "冲刺排位",
  SPRINT: "冲刺赛",
  GRAND_PRIX: "正赛",
};

export const SESSION_STATE_LABELS: Readonly<Record<F1SessionState, string>> = {
  UPCOMING: "可预测",
  LOCKED: "已封盘",
  FINISHED: "已结束",
  CANCELLED: "已取消",
};

export const MARKET_KIND_LABELS: Readonly<Record<F1MarketKind, string>> = {
  POLE: "杆位",
  WINNER: "冠军",
  PODIUM: "领奖台",
  EXACT_PODIUM: "精确前三",
  H2H: "车手对决",
};

export interface F1SessionView {
  id: string;
  kind: F1SessionKind;
  startsAt: string;
  state: F1SessionState;
}

export interface F1WeekendView {
  id: string;
  season: number;
  round: number;
  name: string;
  circuitKey: string;
  isSprintWeekend: boolean;
  sessions: F1SessionView[];
}

export interface F1DriverView {
  code: string;
  number: number;
  name: string;
  constructorKey: string;
  constructorName: string;
  color: string;
  seasonPoints: number;
}

export interface F1MarketView {
  id: string;
  kind: F1MarketKind;
  status: string;
  version: string;
  dataAsOf: string;
  outcomes: Array<{ selection: string; decimalOdds: string }>;
}

export interface F1SessionDetailView {
  session: F1SessionView;
  weekend: Omit<F1WeekendView, "sessions">;
  drivers: F1DriverView[];
  markets: F1MarketView[];
}

const SESSION_KINDS = new Set(["QUALIFYING", "SPRINT_QUALIFYING", "SPRINT", "GRAND_PRIX"]);
const SESSION_STATES = new Set(["UPCOMING", "LOCKED", "FINISHED", "CANCELLED"]);
const MARKET_KINDS = new Set(["POLE", "WINNER", "PODIUM", "EXACT_PODIUM", "H2H"]);

function normalizeSession(value: unknown): F1SessionView | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.startsAt !== "string") return null;
  if (typeof session.kind !== "string" || !SESSION_KINDS.has(session.kind)) return null;
  const state = typeof session.state === "string" && SESSION_STATES.has(session.state) ? session.state : "UPCOMING";
  return { id: session.id, kind: session.kind as F1SessionKind, startsAt: session.startsAt, state: state as F1SessionState };
}

export function normalizeWeekend(value: unknown): F1WeekendView | null {
  if (!value || typeof value !== "object") return null;
  const weekend = value as Record<string, unknown>;
  if (typeof weekend.id !== "string" || typeof weekend.name !== "string") return null;
  if (typeof weekend.season !== "number" || typeof weekend.round !== "number") return null;
  const sessions = Array.isArray(weekend.sessions)
    ? weekend.sessions.map(normalizeSession).filter((session): session is F1SessionView => session !== null)
    : [];
  return {
    id: weekend.id,
    season: weekend.season,
    round: weekend.round,
    name: weekend.name,
    circuitKey: typeof weekend.circuitKey === "string" ? weekend.circuitKey : "",
    isSprintWeekend: weekend.isSprintWeekend === true,
    sessions: sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

export function normalizeSessionDetail(value: unknown): F1SessionDetailView | null {
  if (!value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const session = normalizeSession(detail.session);
  const weekend = normalizeWeekend({ ...(detail.weekend as Record<string, unknown> ?? {}), sessions: [] });
  if (!session || !weekend) return null;
  const drivers = Array.isArray(detail.drivers)
    ? detail.drivers.flatMap((candidate): F1DriverView[] => {
        if (!candidate || typeof candidate !== "object") return [];
        const driver = candidate as Record<string, unknown>;
        if (typeof driver.code !== "string" || typeof driver.name !== "string") return [];
        return [{
          code: driver.code,
          number: typeof driver.number === "number" ? driver.number : 0,
          name: driver.name,
          constructorKey: typeof driver.constructorKey === "string" ? driver.constructorKey : "",
          constructorName: typeof driver.constructorName === "string" ? driver.constructorName : "",
          color: typeof driver.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(driver.color) ? driver.color : "#5f635e",
          seasonPoints: typeof driver.seasonPoints === "number" ? driver.seasonPoints : 0,
        }];
      })
    : [];
  const markets = Array.isArray(detail.markets)
    ? detail.markets.flatMap((candidate): F1MarketView[] => {
        if (!candidate || typeof candidate !== "object") return [];
        const market = candidate as Record<string, unknown>;
        if (typeof market.id !== "string" || typeof market.kind !== "string" || !MARKET_KINDS.has(market.kind)) return [];
        if (typeof market.version !== "string") return [];
        const outcomes = Array.isArray(market.outcomes)
          ? market.outcomes.flatMap((entry): Array<{ selection: string; decimalOdds: string }> => {
              if (!entry || typeof entry !== "object") return [];
              const outcome = entry as Record<string, unknown>;
              if (typeof outcome.selection !== "string" || typeof outcome.decimalOdds !== "string") return [];
              return [{ selection: outcome.selection, decimalOdds: outcome.decimalOdds }];
            })
          : [];
        return [{
          id: market.id,
          kind: market.kind as F1MarketKind,
          status: typeof market.status === "string" ? market.status : "OPEN",
          version: market.version,
          dataAsOf: typeof market.dataAsOf === "string" ? market.dataAsOf : "",
          outcomes,
        }];
      })
    : [];
  return { session, weekend, drivers, markets };
}

/** True while the session accepts predictions: open state and before lights out. */
export function sessionPredictable(session: F1SessionView, now = new Date()): boolean {
  return session.state === "UPCOMING" && new Date(session.startsAt).getTime() > now.getTime();
}
