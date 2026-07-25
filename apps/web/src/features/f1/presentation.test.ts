import { describe, expect, it } from "vitest";
import { normalizeSessionResult, normalizeWeekend, upcomingSessionsOf, weekendPhase, type F1WeekendView } from "./types";

const NOW = new Date("2026-07-24T12:00:00.000Z");

function weekend(input: { round: number; sessions: Array<{ id: string; kind: string; startsAt: string; state: string; podium?: unknown }> }): F1WeekendView {
  const normalized = normalizeWeekend({
    id: `w-${input.round}`,
    season: 2026,
    round: input.round,
    name: `ROUND ${input.round} GP`,
    circuitKey: "spa",
    isSprintWeekend: false,
    sessions: input.sessions,
  });
  if (!normalized) throw new Error("fixture should normalize");
  return normalized;
}

describe("weekendPhase", () => {
  it("keeps a weekend with any open session in upcoming", () => {
    const mixed = weekend({ round: 11, sessions: [
      { id: "q", kind: "QUALIFYING", startsAt: "2026-07-25T14:00:00.000Z", state: "UPCOMING" },
      { id: "r", kind: "GRAND_PRIX", startsAt: "2026-07-26T13:00:00.000Z", state: "UPCOMING" },
    ] });
    expect(weekendPhase(mixed, NOW)).toBe("UPCOMING");
  });

  it("moves a fully finished weekend to history", () => {
    const done = weekend({ round: 10, sessions: [
      { id: "q", kind: "QUALIFYING", startsAt: "2026-07-18T14:00:00.000Z", state: "FINISHED" },
      { id: "r", kind: "GRAND_PRIX", startsAt: "2026-07-19T13:00:00.000Z", state: "FINISHED" },
    ] });
    expect(weekendPhase(done, NOW)).toBe("HISTORY");
  });

  it("treats a cancelled-only past weekend as history but a locked one as still current", () => {
    const cancelled = weekend({ round: 3, sessions: [
      { id: "r", kind: "GRAND_PRIX", startsAt: "2026-03-29T05:00:00.000Z", state: "CANCELLED" },
    ] });
    expect(weekendPhase(cancelled, NOW)).toBe("HISTORY");
    const locked = weekend({ round: 11, sessions: [
      { id: "r", kind: "GRAND_PRIX", startsAt: "2026-07-24T10:00:00.000Z", state: "LOCKED" },
    ] });
    expect(weekendPhase(locked, NOW)).toBe("UPCOMING");
  });
});

describe("normalizeWeekend podium passthrough", () => {
  it("keeps a valid podium sorted and drops malformed entries", () => {
    const view = weekend({ round: 10, sessions: [{
      id: "r", kind: "GRAND_PRIX", startsAt: "2026-07-19T13:00:00.000Z", state: "FINISHED",
      podium: [{ position: 3, driverCode: "VER" }, { position: 1, driverCode: "ANT" }, { position: 2, driverCode: "LEC" }, { bogus: true }],
    }] });
    expect(view.sessions[0]?.podium).toEqual([
      { position: 1, driverCode: "ANT" },
      { position: 2, driverCode: "LEC" },
      { position: 3, driverCode: "VER" },
    ]);
  });
});

describe("normalizeSessionResult", () => {
  it("orders classified positions first and keeps display fields", () => {
    const result = normalizeSessionResult({
      version: 1,
      confirmedAt: "2026-07-19T16:00:00.000Z",
      classification: [
        { driverCode: "STR", position: null, status: "DNF", lapsCompleted: 25 },
        { driverCode: "ANT", position: 1, status: "FINISHED", lapsCompleted: 44, points: 25, fastestLap: false, timeText: "1:19:57.1", grid: 1 },
        { driverCode: "NOR", position: 5, status: "FINISHED", lapsCompleted: 44, fastestLap: true },
      ],
    });
    expect(result?.classification.map((entry) => entry.driverCode)).toEqual(["ANT", "NOR", "STR"]);
    expect(result?.classification[0]).toMatchObject({ points: 25, grid: 1, timeText: "1:19:57.1" });
    expect(result?.classification[1]?.fastestLap).toBe(true);
  });

  it("rejects payloads without a usable classification", () => {
    expect(normalizeSessionResult({ version: 1, classification: [] })).toBeNull();
    expect(normalizeSessionResult({ version: 1, classification: [{ driverCode: "ANT", status: "TELEPORTED" }] })).toBeNull();
    expect(normalizeSessionResult(null)).toBeNull();
  });
});

describe("upcomingSessionsOf", () => {
  it("returns the next predictable sessions across weekends in start order", () => {
    const weekends = [
      weekend({ round: 12, sessions: [
        { id: "dutch-q", kind: "QUALIFYING", startsAt: "2026-08-22T12:00:00.000Z", state: "UPCOMING" },
      ] }),
      weekend({ round: 11, sessions: [
        { id: "hun-q", kind: "QUALIFYING", startsAt: "2026-07-25T14:00:00.000Z", state: "UPCOMING" },
        { id: "hun-r", kind: "GRAND_PRIX", startsAt: "2026-07-26T13:00:00.000Z", state: "UPCOMING" },
        { id: "hun-old", kind: "SPRINT", startsAt: "2026-07-20T13:00:00.000Z", state: "FINISHED" },
      ] }),
    ];
    const upcoming = upcomingSessionsOf(weekends, 2, NOW);
    expect(upcoming.map((session) => session.id)).toEqual(["hun-q", "hun-r"]);
    expect(upcoming[0]?.kindLabel).toBe("排位赛");
  });
});
