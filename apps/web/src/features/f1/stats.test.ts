import { describe, expect, it } from "vitest";
import { driverSeason, podiumOf, teamSeason, type F1StatsSessionResult } from "./stats";

function session(input: Partial<F1StatsSessionResult> & { round: number; kind: F1StatsSessionResult["kind"] }): F1StatsSessionResult {
  return {
    sessionId: `s-${input.round}-${input.kind}`,
    startsAt: `2026-0${Math.min(9, input.round)}-01T12:00:00.000Z`,
    weekendId: `w-${input.round}`,
    weekendName: `ROUND ${input.round} GP`,
    circuitKey: "spa",
    classification: [],
    ...input,
  };
}

const RESULTS: F1StatsSessionResult[] = [
  session({
    round: 1,
    kind: "QUALIFYING",
    classification: [
      { driverCode: "ANT", position: 1, status: "FINISHED", lapsCompleted: 0, timeText: "1:44.361" },
      { driverCode: "LEC", position: 2, status: "FINISHED", lapsCompleted: 0 },
    ],
  }),
  session({
    round: 1,
    kind: "GRAND_PRIX",
    classification: [
      { driverCode: "ANT", position: 1, status: "FINISHED", lapsCompleted: 58, points: 25, fastestLap: true, grid: 1, timeText: "1:23:06.801" },
      { driverCode: "LEC", position: 2, status: "FINISHED", lapsCompleted: 58, points: 18 },
      { driverCode: "HAM", position: 3, status: "FINISHED", lapsCompleted: 58, points: 15 },
      { driverCode: "VER", position: null, status: "DNF", lapsCompleted: 12, points: 0 },
    ],
  }),
  session({
    round: 2,
    kind: "SPRINT",
    classification: [
      { driverCode: "LEC", position: 1, status: "FINISHED", lapsCompleted: 17, points: 8 },
      { driverCode: "ANT", position: 2, status: "FINISHED", lapsCompleted: 17, points: 7 },
    ],
  }),
  session({
    round: 2,
    kind: "GRAND_PRIX",
    classification: [
      { driverCode: "LEC", position: 1, status: "FINISHED", lapsCompleted: 56, points: 25 },
      { driverCode: "ANT", position: 4, status: "FINISHED", lapsCompleted: 56, points: 12 },
      { driverCode: "HAM", position: null, status: "DSQ", lapsCompleted: 56, points: 0 },
    ],
  }),
];

describe("driverSeason", () => {
  it("collects per-session lines newest round first and tallies totals", () => {
    const { entries, totals } = driverSeason("ANT", RESULTS);
    expect(entries.map((entry) => `${entry.round}:${entry.kind}`)).toEqual([
      "2:SPRINT", "2:GRAND_PRIX", "1:QUALIFYING", "1:GRAND_PRIX",
    ]);
    expect(totals).toEqual({ wins: 1, podiums: 1, poles: 1, sprintWins: 0, fastestLaps: 1, dnfs: 0 });
  });

  it("counts DNF and sprint wins without inventing points", () => {
    expect(driverSeason("VER", RESULTS).totals.dnfs).toBe(1);
    const lec = driverSeason("LEC", RESULTS).totals;
    expect(lec).toEqual({ wins: 1, podiums: 2, poles: 0, sprintWins: 1, fastestLaps: 0, dnfs: 0 });
  });

  it("returns empty for a driver with no confirmed lines", () => {
    expect(driverSeason("BOT", RESULTS)).toEqual({ entries: [], totals: { wins: 0, podiums: 0, poles: 0, sprintWins: 0, fastestLaps: 0, dnfs: 0 } });
  });
});

describe("teamSeason", () => {
  it("aggregates both cars per round including sprint points, GP order by position", () => {
    const { rounds, totals } = teamSeason(["LEC", "HAM"], RESULTS);
    expect(rounds.map((round) => round.round)).toEqual([2, 1]);
    const round2 = rounds[0]!;
    expect(round2.pointsTotal).toBe(8 + 25); // sprint 8 + GP 25; DSQ scores 0
    expect(round2.drivers.map((driver) => driver.driverCode)).toEqual(["LEC", "HAM"]); // P1 before unclassified
    expect(totals.wins).toBe(1);
    expect(totals.podiums).toBe(3); // LEC P2 R1 + HAM P3 R1 + LEC P1 R2
    expect(totals.sprintWins).toBe(1);
  });
});

describe("podiumOf", () => {
  it("returns P1-P3 in order and ignores unclassified entries", () => {
    const podium = podiumOf(RESULTS[1]!.classification);
    expect(podium).toEqual([
      { position: 1, driverCode: "ANT" },
      { position: 2, driverCode: "LEC" },
      { position: 3, driverCode: "HAM" },
    ]);
  });
});
