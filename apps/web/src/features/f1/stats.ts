// Pure assembly of driver/team season views from confirmed session results.
// Server routes and unit tests share these; no IO, no fabrication — everything
// derives from classifications imported from the official result source.

export type F1StatsSessionKind = "QUALIFYING" | "SPRINT_QUALIFYING" | "SPRINT" | "GRAND_PRIX";
export type F1StatsStatus = "FINISHED" | "DNF" | "DNS" | "DSQ";

export interface F1StatsClassificationEntry {
  driverCode: string;
  position: number | null;
  status: F1StatsStatus;
  lapsCompleted: number;
  points?: number | undefined;
  timeText?: string | null | undefined;
  fastestLap?: boolean | undefined;
  grid?: number | null | undefined;
}

export interface F1StatsSessionResult {
  sessionId: string;
  kind: F1StatsSessionKind;
  startsAt: string;
  round: number;
  weekendId: string;
  weekendName: string;
  circuitKey: string;
  classification: F1StatsClassificationEntry[];
}

export interface F1DriverSeasonEntry {
  sessionId: string;
  round: number;
  weekendName: string;
  circuitKey: string;
  kind: F1StatsSessionKind;
  startsAt: string;
  position: number | null;
  status: F1StatsStatus;
  points: number | null;
  timeText: string | null;
  fastestLap: boolean;
  grid: number | null;
}

export interface F1DriverSeasonTotals {
  wins: number;
  podiums: number;
  poles: number;
  sprintWins: number;
  fastestLaps: number;
  dnfs: number;
}

/** One driver's per-session lines (newest round first) + season tallies.
 *  wins/podiums count GRAND_PRIX classifications only; poles count QUALIFYING P1. */
export function driverSeason(code: string, results: F1StatsSessionResult[]): { entries: F1DriverSeasonEntry[]; totals: F1DriverSeasonTotals } {
  const entries: F1DriverSeasonEntry[] = [];
  const totals: F1DriverSeasonTotals = { wins: 0, podiums: 0, poles: 0, sprintWins: 0, fastestLaps: 0, dnfs: 0 };
  for (const result of results) {
    const line = result.classification.find((entry) => entry.driverCode === code);
    if (!line) continue;
    entries.push({
      sessionId: result.sessionId,
      round: result.round,
      weekendName: result.weekendName,
      circuitKey: result.circuitKey,
      kind: result.kind,
      startsAt: result.startsAt,
      position: line.position,
      status: line.status,
      points: line.points ?? null,
      timeText: line.timeText ?? null,
      fastestLap: line.fastestLap === true,
      grid: line.grid ?? null,
    });
    const classified = line.status === "FINISHED" && line.position !== null;
    if (result.kind === "GRAND_PRIX") {
      if (classified && line.position === 1) totals.wins += 1;
      if (classified && line.position !== null && line.position <= 3) totals.podiums += 1;
      if (line.fastestLap === true) totals.fastestLaps += 1;
      if (line.status === "DNF") totals.dnfs += 1;
    }
    if (result.kind === "QUALIFYING" && classified && line.position === 1) totals.poles += 1;
    if (result.kind === "SPRINT" && classified && line.position === 1) totals.sprintWins += 1;
  }
  entries.sort((a, b) => b.round - a.round || a.startsAt.localeCompare(b.startsAt));
  return { entries, totals };
}

export interface F1TeamRoundSummary {
  round: number;
  weekendName: string;
  circuitKey: string;
  grandPrixSessionId: string | null;
  /** Per-driver GP finishing line, entry-list order. */
  drivers: Array<{ driverCode: string; position: number | null; status: F1StatsStatus; points: number | null }>;
  pointsTotal: number;
}

/** Team view: per-round GRAND_PRIX summary (newest first) + combined tallies for
 *  the team's drivers. Sprint points are included in pointsTotal per round. */
export function teamSeason(driverCodes: string[], results: F1StatsSessionResult[]): { rounds: F1TeamRoundSummary[]; totals: F1DriverSeasonTotals } {
  const codes = new Set(driverCodes);
  const byRound = new Map<number, F1TeamRoundSummary>();
  const totals: F1DriverSeasonTotals = { wins: 0, podiums: 0, poles: 0, sprintWins: 0, fastestLaps: 0, dnfs: 0 };
  for (const result of results) {
    const lines = result.classification.filter((entry) => codes.has(entry.driverCode));
    if (!lines.length) continue;
    const summary = byRound.get(result.round) ?? {
      round: result.round,
      weekendName: result.weekendName,
      circuitKey: result.circuitKey,
      grandPrixSessionId: null,
      drivers: [],
      pointsTotal: 0,
    };
    for (const line of lines) {
      const classified = line.status === "FINISHED" && line.position !== null;
      if (result.kind === "GRAND_PRIX" || result.kind === "SPRINT") summary.pointsTotal += line.points ?? 0;
      if (result.kind === "GRAND_PRIX") {
        summary.grandPrixSessionId = result.sessionId;
        summary.drivers.push({ driverCode: line.driverCode, position: line.position, status: line.status, points: line.points ?? null });
        if (classified && line.position === 1) totals.wins += 1;
        if (classified && line.position !== null && line.position <= 3) totals.podiums += 1;
        if (line.fastestLap === true) totals.fastestLaps += 1;
        if (line.status === "DNF") totals.dnfs += 1;
      }
      if (result.kind === "QUALIFYING" && classified && line.position === 1) totals.poles += 1;
      if (result.kind === "SPRINT" && classified && line.position === 1) totals.sprintWins += 1;
    }
    byRound.set(result.round, summary);
  }
  const rounds = [...byRound.values()].sort((a, b) => b.round - a.round);
  for (const round of rounds) {
    round.drivers.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  }
  return { rounds, totals };
}

/** Podium (P1-P3) of a classification, for weekend-card chips. */
export function podiumOf(classification: F1StatsClassificationEntry[]): Array<{ position: number; driverCode: string }> {
  return classification
    .filter((entry) => entry.status === "FINISHED" && entry.position !== null && entry.position <= 3)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((entry) => ({ position: entry.position as number, driverCode: entry.driverCode }));
}
