/** Pure mapping layer for importing official F1 session results from an
 *  Ergast-compatible source (Jolpica, the maintained Ergast successor).
 *  IO-free: the import script feeds raw payload rows in and persists the
 *  returned classifications; every entry stays traceable to the source row.
 *
 *  Coverage note: Ergast-compatible sources publish GRAND_PRIX (/results),
 *  QUALIFYING (/qualifying) and SPRINT (/sprint) classifications. There is no
 *  SPRINT_QUALIFYING endpoint — those sessions must never be given a fabricated
 *  classification; the planner reports them as NO_SOURCE_DATA instead. */

import type { F1ClassificationEntry, F1ClassificationStatus, F1SessionKind, F1SessionState } from "./types.js";
import { validateF1Classification } from "./results.js";

/** Subset of an Ergast result/sprint/qualifying row that the mapper consumes. */
export interface ErgastResultRow {
  position?: string | undefined;
  positionText?: string | undefined;
  points?: string | undefined;
  grid?: string | undefined;
  laps?: string | undefined;
  status?: string | undefined;
  Driver?: { code?: string | undefined; driverId?: string | undefined } | undefined;
  Time?: { time?: string | undefined } | undefined;
  FastestLap?: { rank?: string | undefined } | undefined;
  Q1?: string | undefined;
  Q2?: string | undefined;
  Q3?: string | undefined;
}

export interface ErgastMappingIssue {
  driverRef: string;
  reason: "MISSING_DRIVER_CODE" | "UNKNOWN_DRIVER_CODE" | "INVALID_ROW";
}

export interface ErgastMappingResult {
  classification: F1ClassificationEntry[];
  issues: ErgastMappingIssue[];
}

/** Ergast positionText semantics: a numeric value means the driver is classified
 *  (lapped finishers keep a number), "R" retired, "D" disqualified, "E" excluded,
 *  "W" withdrew, "F" failed to qualify, "N" not classified. */
export function ergastStatusOf(row: ErgastResultRow): F1ClassificationStatus {
  const positionText = row.positionText ?? row.position ?? "";
  if (/^\d+$/.test(positionText)) return "FINISHED";
  if (positionText === "D" || positionText === "E") return "DSQ";
  if (positionText === "W") return "DNS";
  if (/did not start|withdr/i.test(row.status ?? "")) return "DNS";
  return "DNF";
}

function intOrNull(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function entryFromRow(row: ErgastResultRow, timeText: string | null): F1ClassificationEntry | null {
  const code = row.Driver?.code;
  if (!code) return null;
  const status = ergastStatusOf(row);
  const position = status === "FINISHED" ? intOrNull(row.positionText ?? row.position) : null;
  const entry: F1ClassificationEntry = {
    driverCode: code,
    position,
    status,
    lapsCompleted: intOrNull(row.laps) ?? 0,
  };
  const points = row.points === undefined ? null : Number(row.points);
  if (points !== null && Number.isFinite(points)) entry.points = points;
  if (timeText !== null) entry.timeText = timeText;
  if (row.FastestLap?.rank === "1") entry.fastestLap = true;
  const grid = intOrNull(row.grid);
  if (grid !== null) entry.grid = grid;
  return entry;
}

function mapRows(
  rows: ErgastResultRow[],
  timeOf: (row: ErgastResultRow) => string | null,
  knownDriverCodes?: ReadonlySet<string>,
): ErgastMappingResult {
  const classification: F1ClassificationEntry[] = [];
  const issues: ErgastMappingIssue[] = [];
  for (const row of rows) {
    const entry = entryFromRow(row, timeOf(row));
    if (!entry) {
      issues.push({ driverRef: row.Driver?.driverId ?? "(unknown)", reason: "MISSING_DRIVER_CODE" });
      continue;
    }
    if (knownDriverCodes && !knownDriverCodes.has(entry.driverCode)) {
      issues.push({ driverRef: entry.driverCode, reason: "UNKNOWN_DRIVER_CODE" });
      continue;
    }
    classification.push(entry);
  }
  return { classification, issues };
}

/** Maps a race-style classification (GRAND_PRIX `/results` or SPRINT `/sprint`). */
export function mapErgastRaceClassification(rows: ErgastResultRow[], knownDriverCodes?: ReadonlySet<string>): ErgastMappingResult {
  return mapRows(rows, (row) => row.Time?.time ?? null, knownDriverCodes);
}

/** Maps a `/qualifying` classification. Qualifying rows carry no lap counts;
 *  the best available segment time (Q3 → Q2 → Q1) becomes the display time. */
export function mapErgastQualifyingClassification(rows: ErgastResultRow[], knownDriverCodes?: ReadonlySet<string>): ErgastMappingResult {
  return mapRows(rows, (row) => row.Q3 ?? row.Q2 ?? row.Q1 ?? null, knownDriverCodes);
}

function canonicalEntry(entry: F1ClassificationEntry): string {
  return JSON.stringify({
    driverCode: entry.driverCode,
    position: entry.position,
    status: entry.status,
    lapsCompleted: entry.lapsCompleted,
    points: entry.points ?? null,
    timeText: entry.timeText ?? null,
    fastestLap: entry.fastestLap ?? false,
    grid: entry.grid ?? null,
  });
}

/** Order-insensitive equality used for idempotent re-imports: an unchanged source
 *  classification must not produce a new result version. */
export function classificationsEqual(a: F1ClassificationEntry[], b: F1ClassificationEntry[]): boolean {
  if (a.length !== b.length) return false;
  const sortByDriver = (entries: F1ClassificationEntry[]) =>
    [...entries].sort((left, right) => left.driverCode.localeCompare(right.driverCode)).map(canonicalEntry);
  const left = sortByDriver(a);
  const right = sortByDriver(b);
  return left.every((value, index) => value === right[index]);
}

/** Ergast session-kind → source endpoint that carries its classification. */
export const ERGAST_SOURCE_BY_KIND: Readonly<Partial<Record<F1SessionKind, "results" | "qualifying" | "sprint">>> = {
  GRAND_PRIX: "results",
  QUALIFYING: "qualifying",
  SPRINT: "sprint",
};

export type F1ImportAction =
  | { action: "IMPORT"; classification: F1ClassificationEntry[] }
  | { action: "SKIP_UNCHANGED" }
  | { action: "NOT_STARTED" }
  | { action: "CANCELLED" }
  | { action: "NO_SOURCE_DATA" }
  | { action: "INVALID"; reason: string };

/** Decides what the importer should do for one session. Sessions that have not
 *  started stay untouched (never mark a future session FINISHED), cancelled
 *  sessions are left to the admin flow, and an unchanged classification is a
 *  no-op so repeated imports stay idempotent. */
export function planSessionImport(input: {
  session: { kind: F1SessionKind; startsAt: string; state: F1SessionState };
  now: Date;
  sourceClassification: F1ClassificationEntry[] | null;
  existingConfirmed: F1ClassificationEntry[] | null;
}): F1ImportAction {
  if (new Date(input.session.startsAt).getTime() > input.now.getTime()) return { action: "NOT_STARTED" };
  if (input.session.state === "CANCELLED") return { action: "CANCELLED" };
  if (!input.sourceClassification || input.sourceClassification.length === 0) return { action: "NO_SOURCE_DATA" };
  const validation = validateF1Classification(input.sourceClassification);
  if (!validation.ok) return { action: "INVALID", reason: validation.reason };
  if (input.existingConfirmed && classificationsEqual(input.existingConfirmed, input.sourceClassification)) {
    return { action: "SKIP_UNCHANGED" };
  }
  return { action: "IMPORT", classification: input.sourceClassification };
}
