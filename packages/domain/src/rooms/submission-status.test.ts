import { describe, expect, it } from "vitest";
import { projectSubmissionBoard, submissionEventPhase, type SubmissionStatusRow } from "./submission-status.js";

const NOW = new Date("2026-07-23T12:00:00Z");

const row = (overrides: Partial<SubmissionStatusRow>): SubmissionStatusRow => ({
  sport: "FOOTBALL",
  eventId: "api-football:1",
  homeTeam: "法国",
  awayTeam: "西班牙",
  startsAt: "2026-07-24T18:00:00Z",
  lifecycleState: "SCHEDULED",
  userId: "user-1",
  displayName: "成员一",
  submitted: false,
  ...overrides,
});

describe("submissionEventPhase", () => {
  it("keeps the historical football rule: FINISHED, otherwise time-based", () => {
    expect(submissionEventPhase("FOOTBALL", "FINISHED", "2026-07-20T18:00:00Z", NOW)).toBe("FINISHED");
    expect(submissionEventPhase("FOOTBALL", "SCHEDULED", "2026-07-24T18:00:00Z", NOW)).toBe("OPEN");
    expect(submissionEventPhase("FOOTBALL", "SCHEDULED", "2026-07-23T12:00:00Z", NOW)).toBe("CLOSED");
    expect(submissionEventPhase("FOOTBALL", "LIVE", "2026-07-23T11:00:00Z", NOW)).toBe("CLOSED");
  });

  it("maps F1 session states onto the shared phases", () => {
    expect(submissionEventPhase("FORMULA_1", "UPCOMING", "2026-07-31T14:00:00Z", NOW)).toBe("OPEN");
    expect(submissionEventPhase("FORMULA_1", "LOCKED", "2026-07-31T14:00:00Z", NOW)).toBe("CLOSED");
    expect(submissionEventPhase("FORMULA_1", "FINISHED", "2026-07-21T12:00:00Z", NOW)).toBe("FINISHED");
    expect(submissionEventPhase("FORMULA_1", "CANCELLED", "2026-07-21T12:00:00Z", NOW)).toBe("FINISHED");
  });

  it("closes an overdue UPCOMING F1 session by time even before the lock sweep runs", () => {
    expect(submissionEventPhase("FORMULA_1", "UPCOMING", "2026-07-23T11:59:00Z", NOW)).toBe("CLOSED");
  });
});

describe("projectSubmissionBoard", () => {
  it("groups football and F1 rows into one board ordered by start time", () => {
    const board = projectSubmissionBoard([
      row({ eventId: "api-football:1", startsAt: "2026-07-24T18:00:00Z" }),
      row({ eventId: "api-football:1", startsAt: "2026-07-24T18:00:00Z", userId: "user-2", displayName: "成员二", submitted: true }),
      row({
        sport: "FORMULA_1", eventId: "f1:session-1", homeTeam: "HUNGARIAN GRAND PRIX", awayTeam: "QUALIFYING",
        startsAt: "2026-07-31T14:00:00Z", lifecycleState: "UPCOMING", submitted: true,
      }),
    ], NOW);

    expect(board.map((event) => event.matchId)).toEqual(["api-football:1", "f1:session-1"]);
    expect(board[0]).toMatchObject({ sport: "FOOTBALL", status: "OPEN", members: [
      { userId: "user-1", displayName: "成员一", submitted: false },
      { userId: "user-2", displayName: "成员二", submitted: true },
    ] });
    expect(board[1]).toMatchObject({
      sport: "FORMULA_1", homeTeam: "HUNGARIAN GRAND PRIX", awayTeam: "QUALIFYING", status: "OPEN",
      members: [{ userId: "user-1", displayName: "成员一", submitted: true }],
    });
  });

  it("never leaks anything beyond the submitted boolean, even when the data layer over-selects", () => {
    const leakyRow = {
      ...row({ sport: "FORMULA_1", eventId: "f1:session-1", lifecycleState: "UPCOMING", submitted: true }),
      // Simulates a future query regression that starts selecting sensitive columns.
      selection: "PODIUM:HAM:YES",
      stakePoints: "500",
      decimalOdds: "4.85",
    } as SubmissionStatusRow;

    const [event] = projectSubmissionBoard([leakyRow], NOW);
    // Story 12.6 widened this by exactly the avatar pair, and by nothing else:
    // the projection is an explicit allowlist, never a spread of the source row.
    expect(event?.members[0]).toEqual({ userId: "user-1", displayName: "成员一", submitted: true, avatarUrl: null, avatarVersion: null });
    expect(JSON.stringify(event)).not.toContain("PODIUM");
    expect(JSON.stringify(event)).not.toContain("4.85");
    expect(JSON.stringify(event)).not.toContain("500");
  });

  it("carries the avatar pair when the query joined one, and nulls when it did not", () => {
    const [event] = projectSubmissionBoard(
      [
        row({ userId: "user-1", avatarUrl: "/api/v1/media/avatars/7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607/2.webp", avatarVersion: 2 }),
        row({ userId: "user-2", displayName: "成员二" }),
      ],
      NOW,
    );
    expect(event?.members).toEqual([
      { userId: "user-1", displayName: "成员一", submitted: false, avatarUrl: "/api/v1/media/avatars/7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607/2.webp", avatarVersion: 2 },
      { userId: "user-2", displayName: "成员二", submitted: false, avatarUrl: null, avatarVersion: null },
    ]);
  });

  it("coerces a non-boolean submitted flag to a boolean instead of passing raw data through", () => {
    const [event] = projectSubmissionBoard([row({ submitted: "PODIUM:HAM:YES" as unknown as boolean })], NOW);
    expect(event?.members[0]?.submitted).toBe(false);
  });
});
