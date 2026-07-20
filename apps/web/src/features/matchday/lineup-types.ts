// Client-side view model + normalizer for GET /api/v1/matches/[matchId]/lineup.
// The API already returns typed data, but the network is untrusted, so we validate
// defensively and split each team into starters / bench for the pitch layout.

export type LineupApiStatus = "LINEUP_PENDING" | "CONFIRMED" | "EXPECTED" | "DATA_STALE" | "DATA_UNAVAILABLE";
export type PlayerPosition = "GK" | "DEF" | "MID" | "FWD" | "UNKNOWN";
export type PlayerStatus = "STARTING" | "BENCH" | "SUBBED_ON" | "SUBBED_OFF";

export interface LineupPlayerView {
  id: number;
  name: string;
  number: number | null;
  position: PlayerPosition;
  positionRaw: string | null;
  grid: string | null;
  photoUrl: string | null;
  starter: boolean;
  status: PlayerStatus;
}

export interface TeamLineupView {
  teamId: number;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  formation: string | null;
  coach: string | null;
  starters: LineupPlayerView[];
  bench: LineupPlayerView[];
}

export interface LineupView {
  status: LineupApiStatus;
  stale: boolean;
  confirmed: boolean;
  dataAsOf: string | null;
  capturedAt: string | null;
  home: TeamLineupView | null;
  away: TeamLineupView | null;
}

const STATUSES: ReadonlySet<string> = new Set(["LINEUP_PENDING", "CONFIRMED", "EXPECTED", "DATA_STALE", "DATA_UNAVAILABLE"]);
const POSITIONS: ReadonlySet<string> = new Set(["GK", "DEF", "MID", "FWD", "UNKNOWN"]);
const PLAYER_STATUSES: ReadonlySet<string> = new Set(["STARTING", "BENCH", "SUBBED_ON", "SUBBED_OFF"]);

/** Pitch rows run from a team's own goal outward. UNKNOWN sits nearest the halfway line so no player is dropped. */
export const POSITION_ORDER: readonly PlayerPosition[] = ["GK", "DEF", "MID", "FWD", "UNKNOWN"];
export const POSITION_LABEL: Readonly<Record<PlayerPosition, string>> = {
  GK: "门将",
  DEF: "后卫",
  MID: "中场",
  FWD: "前锋",
  UNKNOWN: "其他",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function player(value: unknown): LineupPlayerView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.id)) return null;
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  const position = typeof raw.position === "string" && POSITIONS.has(raw.position) ? (raw.position as PlayerPosition) : "UNKNOWN";
  const status = typeof raw.status === "string" && PLAYER_STATUSES.has(raw.status) ? (raw.status as PlayerStatus) : "BENCH";
  return {
    id: raw.id as number,
    name: raw.name,
    number: Number.isSafeInteger(raw.number) ? (raw.number as number) : null,
    position,
    positionRaw: str(raw.positionRaw),
    grid: str(raw.grid),
    photoUrl: str(raw.photoUrl),
    starter: raw.starter === true,
    status,
  };
}

function team(value: unknown): TeamLineupView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.teamId) || typeof raw.name !== "string" || raw.name.length === 0) return null;
  const players = Array.isArray(raw.players) ? raw.players.map(player).filter((item): item is LineupPlayerView => item !== null) : [];
  return {
    teamId: raw.teamId as number,
    name: raw.name,
    logoUrl: str(raw.logoUrl),
    primaryColor: str(raw.primaryColor),
    formation: str(raw.formation),
    coach: str(raw.coach),
    starters: players.filter((item) => item.starter),
    bench: players.filter((item) => !item.starter),
  };
}

export function lineupViewFromPayload(payload: unknown): LineupView | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.status !== "string" || !STATUSES.has(raw.status)) return null;
  return {
    status: raw.status as LineupApiStatus,
    stale: raw.stale === true,
    confirmed: raw.confirmed === true,
    dataAsOf: str(raw.dataAsOf),
    capturedAt: str(raw.capturedAt),
    home: team(raw.home),
    away: team(raw.away),
  };
}

/** Column within a pitch line, from API-Football "row:col" grid; used only to order same-line players. */
function gridColumn(grid: string | null): number {
  if (!grid) return Number.POSITIVE_INFINITY;
  const column = Number.parseInt(grid.split(":")[1] ?? "", 10);
  return Number.isFinite(column) ? column : Number.POSITIVE_INFINITY;
}

/** Group starters into pitch lines (GK→FWD). Empty lines are dropped; players keep supplier order, refined by grid/number. */
export function positionRows(starters: readonly LineupPlayerView[]): Array<{ position: PlayerPosition; label: string; players: LineupPlayerView[] }> {
  return POSITION_ORDER.map((position) => {
    const players = starters
      .filter((item) => item.position === position)
      .sort((left, right) => gridColumn(left.grid) - gridColumn(right.grid));
    return { position, label: POSITION_LABEL[position], players };
  }).filter((row) => row.players.length > 0);
}

export interface LineupStatusDescription {
  tone: "ok" | "info" | "warn" | "error";
  label: string;
  detail: string;
}

/** Human-facing status badge + explanation. Never implies players exist when they do not. */
export function describeLineupStatus(view: Pick<LineupView, "status" | "confirmed">): LineupStatusDescription {
  const basis = view.confirmed ? "官方首发" : "预计阵容";
  switch (view.status) {
    case "CONFIRMED":
      return { tone: "ok", label: "官方首发", detail: "以下为已确认的首发与替补名单。" };
    case "EXPECTED":
      return { tone: "warn", label: "预计首发", detail: "以下为预计阵容，尚未官方确认，可能与最终名单不同。" };
    case "DATA_STALE":
      return { tone: "warn", label: "数据可能过期", detail: `显示最后一次获取到的阵容（基于${basis}），可能不是最新。` };
    case "DATA_UNAVAILABLE":
      return { tone: "error", label: "阵容数据暂不可用", detail: "暂时无法取得本场阵容，请稍后再试。" };
    case "LINEUP_PENDING":
    default:
      return { tone: "info", label: "阵容未公布", detail: "球队尚未公布本场首发名单，公布后将在此显示。" };
  }
}
