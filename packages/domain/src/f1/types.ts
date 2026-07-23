/** Formula 1 business model — race weekends, sessions, drivers, constructors.
 *  SoT: docs/product/pulse-multisport-brand-ui-redesign.md §12.4–12.5.
 *  Deliberately independent from the football home/away fixture model. */

/** The four predictable session kinds of a Grand Prix weekend (§12.5). */
export type F1SessionKind = "QUALIFYING" | "SPRINT_QUALIFYING" | "SPRINT" | "GRAND_PRIX";

export const F1_SESSION_KINDS: readonly F1SessionKind[] = ["QUALIFYING", "SPRINT_QUALIFYING", "SPRINT", "GRAND_PRIX"];

/** Session kinds present on a conventional weekend vs a sprint weekend. */
export const CONVENTIONAL_WEEKEND_SESSIONS: readonly F1SessionKind[] = ["QUALIFYING", "GRAND_PRIX"];
export const SPRINT_WEEKEND_SESSIONS: readonly F1SessionKind[] = ["SPRINT_QUALIFYING", "SPRINT", "QUALIFYING", "GRAND_PRIX"];

export type F1SessionState = "UPCOMING" | "LOCKED" | "FINISHED" | "CANCELLED";

export interface F1Constructor {
  /** Stable slug, e.g. "mclaren". */
  key: string;
  name: string;
  /** Identity strip color (3px team line in the timing tower). */
  color: string;
}

export interface F1Driver {
  /** FIA-style three-letter code, e.g. "NOR". Unique within a season. */
  code: string;
  /** Permanent race number. */
  number: number;
  name: string;
  constructorKey: string;
  active: boolean;
}

export interface F1Session {
  id: string;
  weekendId: string;
  kind: F1SessionKind;
  /** Session start; predictions lock exactly here (Q1 start / lights out, §12.5). */
  startsAt: string;
  state: F1SessionState;
  /** Confirmed result version (monotonic per session); null until first confirmation. */
  resultVersion: number | null;
  resultConfirmed: boolean;
}

export interface F1RaceWeekend {
  id: string;
  season: number;
  round: number;
  /** e.g. "BRITISH GRAND PRIX" */
  name: string;
  /** Abstract circuit outline key (design-system circuits index), e.g. "silverstone". */
  circuitKey: string;
  isSprintWeekend: boolean;
  sessions: F1Session[];
}

/** Per-driver classification line of an official session result (§12.5 结算规则). */
export type F1ClassificationStatus = "FINISHED" | "DNF" | "DNS" | "DSQ";

export interface F1ClassificationEntry {
  driverCode: string;
  /** Final classified position; null for DNS and unclassified retirements. */
  position: number | null;
  status: F1ClassificationStatus;
  /** Laps completed — required to order double-DNF head-to-heads. */
  lapsCompleted: number;
}

export interface F1SessionResult {
  sessionId: string;
  version: number;
  classification: F1ClassificationEntry[];
}
