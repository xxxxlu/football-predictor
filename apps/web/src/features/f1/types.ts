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
  // PODIUM 与 H2H 已下架（历史票据展示仍需要标签）；领奖台之争 = 全车手自由组合前三。
  PODIUM: "领奖台",
  EXACT_PODIUM: "领奖台之争",
  H2H: "车手对决",
};

export interface F1SessionView {
  id: string;
  kind: F1SessionKind;
  startsAt: string;
  state: F1SessionState;
  /** Confirmed P1-P3, present once an official result version is confirmed. */
  podium?: Array<{ position: number; driverCode: string }> | null;
}

export type F1ClassificationStatusView = "FINISHED" | "DNF" | "DNS" | "DSQ";

export interface F1ClassificationEntryView {
  driverCode: string;
  position: number | null;
  status: F1ClassificationStatusView;
  lapsCompleted: number;
  points: number | null;
  timeText: string | null;
  fastestLap: boolean;
  grid: number | null;
}

export interface F1SessionResultView {
  version: number;
  confirmedAt: string | null;
  classification: F1ClassificationEntryView[];
}

export const CLASSIFICATION_STATUS_LABELS: Readonly<Record<F1ClassificationStatusView, string>> = {
  FINISHED: "完赛",
  DNF: "退赛",
  DNS: "未发车",
  DSQ: "取消成绩",
};

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
  result: F1SessionResultView | null;
}

const SESSION_KINDS = new Set(["QUALIFYING", "SPRINT_QUALIFYING", "SPRINT", "GRAND_PRIX"]);
const SESSION_STATES = new Set(["UPCOMING", "LOCKED", "FINISHED", "CANCELLED"]);
const MARKET_KINDS = new Set(["POLE", "WINNER", "PODIUM", "EXACT_PODIUM", "H2H"]);

function normalizePodium(value: unknown): Array<{ position: number; driverCode: string }> | null {
  if (!Array.isArray(value)) return null;
  const podium = value.flatMap((candidate): Array<{ position: number; driverCode: string }> => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.position !== "number" || typeof entry.driverCode !== "string") return [];
    return [{ position: entry.position, driverCode: entry.driverCode }];
  });
  return podium.length ? podium.sort((a, b) => a.position - b.position) : null;
}

function normalizeSession(value: unknown): F1SessionView | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.startsAt !== "string") return null;
  if (typeof session.kind !== "string" || !SESSION_KINDS.has(session.kind)) return null;
  const state = typeof session.state === "string" && SESSION_STATES.has(session.state) ? session.state : "UPCOMING";
  return {
    id: session.id,
    kind: session.kind as F1SessionKind,
    startsAt: session.startsAt,
    state: state as F1SessionState,
    podium: normalizePodium(session.podium),
  };
}

const CLASSIFICATION_STATUSES = new Set(["FINISHED", "DNF", "DNS", "DSQ"]);

export function normalizeSessionResult(value: unknown): F1SessionResultView | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (typeof result.version !== "number" || !Array.isArray(result.classification)) return null;
  const classification = result.classification.flatMap((candidate): F1ClassificationEntryView[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.driverCode !== "string") return [];
    if (typeof entry.status !== "string" || !CLASSIFICATION_STATUSES.has(entry.status)) return [];
    return [{
      driverCode: entry.driverCode,
      position: typeof entry.position === "number" ? entry.position : null,
      status: entry.status as F1ClassificationStatusView,
      lapsCompleted: typeof entry.lapsCompleted === "number" ? entry.lapsCompleted : 0,
      points: typeof entry.points === "number" ? entry.points : null,
      timeText: typeof entry.timeText === "string" ? entry.timeText : null,
      fastestLap: entry.fastestLap === true,
      grid: typeof entry.grid === "number" ? entry.grid : null,
    }];
  });
  if (!classification.length) return null;
  classification.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || b.lapsCompleted - a.lapsCompleted);
  return {
    version: result.version,
    confirmedAt: typeof result.confirmedAt === "string" ? result.confirmedAt : null,
    classification,
  };
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
  return { session, weekend, drivers, markets, result: normalizeSessionResult(detail.result) };
}

/** True while the session accepts predictions: open state and before lights out. */
export function sessionPredictable(session: F1SessionView, now = new Date()): boolean {
  return session.state === "UPCOMING" && new Date(session.startsAt).getTime() > now.getTime();
}

export type WeekendPhaseFilter = "UPCOMING" | "HISTORY";

/** A weekend is history once none of its sessions can still run: everything is
 *  FINISHED/CANCELLED, or already past its start time without being predictable. */
export function weekendPhase(weekend: F1WeekendView, now = new Date()): WeekendPhaseFilter {
  const open = weekend.sessions.some((session) =>
    session.state === "UPCOMING" || session.state === "LOCKED" || new Date(session.startsAt).getTime() > now.getTime());
  return open ? "UPCOMING" : "HISTORY";
}

export interface F1UpcomingSessionView {
  id: string;
  weekendName: string;
  round: number;
  kindLabel: string;
  startsAt: string;
}

/** Next predictable sessions across weekends, soonest first. */
export function upcomingSessionsOf(weekends: F1WeekendView[], limit: number, now = new Date()): F1UpcomingSessionView[] {
  return weekends
    .flatMap((weekend) => weekend.sessions
      .filter((session) => sessionPredictable(session, now))
      .map((session) => ({
        id: session.id,
        weekendName: weekend.name,
        round: weekend.round,
        kindLabel: SESSION_KIND_LABELS[session.kind],
        startsAt: session.startsAt,
      })))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}
