/** Sport-neutral projection for the room owner's submission-status wall.
 *
 *  The wall answers exactly one question per member and event: "has this member
 *  submitted?". The projection therefore copies an explicit field allowlist —
 *  never the row object — so a data-layer query that accidentally selects
 *  selections, stakes or odds can not leak them through this surface before
 *  (or after) an event locks. */

export type SubmissionSport = "FOOTBALL" | "FORMULA_1";
export type SubmissionEventPhase = "OPEN" | "CLOSED" | "FINISHED";

/** One (event × member) source row from the data layer. `lifecycleState` is the
 *  sport's own vocabulary: supplier fixture status for football, session state
 *  for F1; the projection maps both onto the shared OPEN/CLOSED/FINISHED. */
export interface SubmissionStatusRow {
  sport: SubmissionSport;
  /** Canonical event id: supplier fixture id, or `f1:<sessionId>`. */
  eventId: string;
  /** Football home team / F1 race-weekend name. */
  homeTeam: string;
  /** Football away team / F1 session kind. */
  awayTeam: string;
  startsAt: string;
  lifecycleState: string;
  userId: string;
  displayName: string;
  submitted: boolean;
}

export interface SubmissionBoardEvent {
  matchId: string;
  sport: SubmissionSport;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  status: SubmissionEventPhase;
  members: Array<{ userId: string; displayName: string; submitted: boolean }>;
}

/** Maps a sport-specific lifecycle onto the wall's shared phase. Football keeps
 *  its historical rule (FINISHED, else time-based); F1 counts LOCKED and
 *  CANCELLED explicitly and still closes by time if the lock sweep lags. */
export function submissionEventPhase(sport: SubmissionSport, lifecycleState: string, startsAt: string, now: Date): SubmissionEventPhase {
  if (sport === "FORMULA_1") {
    if (lifecycleState === "FINISHED" || lifecycleState === "CANCELLED") return "FINISHED";
    if (lifecycleState === "LOCKED") return "CLOSED";
    return now.getTime() >= new Date(startsAt).getTime() ? "CLOSED" : "OPEN";
  }
  if (lifecycleState === "FINISHED") return "FINISHED";
  return now.getTime() >= new Date(startsAt).getTime() ? "CLOSED" : "OPEN";
}

/** Groups rows into events ordered by start time. Member order follows row
 *  order within each event (the data layer orders by join date). */
export function projectSubmissionBoard(rows: readonly SubmissionStatusRow[], now: Date): SubmissionBoardEvent[] {
  const events = new Map<string, SubmissionBoardEvent>();
  for (const row of rows) {
    let event = events.get(row.eventId);
    if (!event) {
      event = {
        matchId: row.eventId,
        sport: row.sport,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        kickoffAt: row.startsAt,
        status: submissionEventPhase(row.sport, row.lifecycleState, row.startsAt, now),
        members: [],
      };
      events.set(row.eventId, event);
    }
    // Explicit allowlist — see module doc. Never spread `row` here.
    event.members.push({ userId: row.userId, displayName: row.displayName, submitted: row.submitted === true });
  }
  return [...events.values()].sort((left, right) => left.kickoffAt.localeCompare(right.kickoffAt) || left.matchId.localeCompare(right.matchId));
}
