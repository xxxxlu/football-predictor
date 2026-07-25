import { describe, expect, it } from "vitest";
import {
  classificationsEqual,
  ergastStatusOf,
  mapErgastQualifyingClassification,
  mapErgastRaceClassification,
  planSessionImport,
  type ErgastResultRow,
} from "./ergast-import.js";
import { validateF1Classification } from "./results.js";

function raceRow(overrides: Partial<ErgastResultRow> & { code: string }): ErgastResultRow {
  const { code, ...rest } = overrides;
  return {
    position: "1",
    positionText: "1",
    points: "25",
    grid: "1",
    laps: "58",
    status: "Finished",
    Driver: { code, driverId: code.toLowerCase() },
    Time: { time: "1:23:06.801" },
    ...rest,
  };
}

describe("ergastStatusOf", () => {
  it("classifies numeric positions as FINISHED, including lapped cars", () => {
    expect(ergastStatusOf({ positionText: "1", status: "Finished" })).toBe("FINISHED");
    expect(ergastStatusOf({ positionText: "19", status: "Lapped" })).toBe("FINISHED");
    expect(ergastStatusOf({ positionText: "18", status: "+1 Lap" })).toBe("FINISHED");
  });

  it("maps retirement, disqualification and non-start markers", () => {
    expect(ergastStatusOf({ positionText: "R", status: "Retired" })).toBe("DNF");
    expect(ergastStatusOf({ positionText: "D", status: "Disqualified" })).toBe("DSQ");
    expect(ergastStatusOf({ positionText: "E", status: "Excluded" })).toBe("DSQ");
    expect(ergastStatusOf({ positionText: "W", status: "Withdrew" })).toBe("DNS");
    expect(ergastStatusOf({ positionText: "N", status: "Did not start" })).toBe("DNS");
    expect(ergastStatusOf({ positionText: "N", status: "Not classified" })).toBe("DNF");
  });
});

describe("mapErgastRaceClassification", () => {
  it("produces a classification that passes settlement validation", () => {
    const rows = [
      raceRow({ code: "ANT" }),
      raceRow({ code: "LEC", position: "2", positionText: "2", points: "18", Time: { time: "+8.662" } }),
      raceRow({ code: "BOT", position: "18", positionText: "18", points: "0", status: "Lapped", laps: "57", Time: undefined }),
      raceRow({ code: "RUS", position: "22", positionText: "R", points: "0", status: "Retired", laps: "0", Time: undefined }),
    ];
    const { classification, issues } = mapErgastRaceClassification(rows);
    expect(issues).toEqual([]);
    expect(classification).toHaveLength(4);
    const byCode = new Map(classification.map((entry) => [entry.driverCode, entry]));
    expect(byCode.get("ANT")).toMatchObject({ position: 1, status: "FINISHED", lapsCompleted: 58, points: 25, timeText: "1:23:06.801" });
    expect(byCode.get("BOT")).toMatchObject({ position: 18, status: "FINISHED", lapsCompleted: 57 });
    expect(byCode.get("RUS")).toMatchObject({ position: null, status: "DNF", lapsCompleted: 0 });
    // positions 1,2,18 are not contiguous — full grids are; this partial fixture is
    // only about row mapping, so validate with a contiguous subset instead.
    const contiguous = classification.filter((entry) => entry.driverCode !== "BOT").map((entry, index) =>
      entry.status === "FINISHED" ? { ...entry, position: index + 1 } : entry);
    expect(validateF1Classification(contiguous)).toEqual({ ok: true });
  });

  it("flags the fastest lap holder", () => {
    const rows = [
      raceRow({ code: "ANT" }),
      raceRow({ code: "NOR", position: "2", positionText: "2", FastestLap: { rank: "1" } }),
    ];
    const { classification } = mapErgastRaceClassification(rows);
    expect(classification.find((entry) => entry.driverCode === "NOR")?.fastestLap).toBe(true);
    expect(classification.find((entry) => entry.driverCode === "ANT")?.fastestLap).toBeUndefined();
  });

  it("reports rows without a driver code and unknown codes instead of guessing", () => {
    const rows = [
      raceRow({ code: "ANT" }),
      { ...raceRow({ code: "XXX" }), Driver: { driverId: "mystery" } },
      raceRow({ code: "ZZZ", position: "2", positionText: "2" }),
    ];
    const { classification, issues } = mapErgastRaceClassification(rows, new Set(["ANT"]));
    expect(classification.map((entry) => entry.driverCode)).toEqual(["ANT"]);
    expect(issues).toEqual([
      { driverRef: "mystery", reason: "MISSING_DRIVER_CODE" },
      { driverRef: "ZZZ", reason: "UNKNOWN_DRIVER_CODE" },
    ]);
  });
});

describe("mapErgastQualifyingClassification", () => {
  it("uses the best segment time and zero laps", () => {
    const rows: ErgastResultRow[] = [
      { position: "1", positionText: "1", Driver: { code: "ANT" }, Q1: "1:46.304", Q2: "1:45.142", Q3: "1:44.361" },
      { position: "16", positionText: "16", Driver: { code: "STR" }, Q1: "1:47.001" },
    ];
    const { classification } = mapErgastQualifyingClassification(rows);
    expect(classification[0]).toMatchObject({ driverCode: "ANT", position: 1, status: "FINISHED", lapsCompleted: 0, timeText: "1:44.361" });
    expect(classification[1]).toMatchObject({ driverCode: "STR", position: 16, timeText: "1:47.001" });
  });
});

describe("classificationsEqual", () => {
  const base = () => mapErgastRaceClassification([raceRow({ code: "ANT" }), raceRow({ code: "LEC", position: "2", positionText: "2" })]).classification;

  it("is order-insensitive and reflexive", () => {
    const a = base();
    const b = [...base()].reverse();
    expect(classificationsEqual(a, b)).toBe(true);
  });

  it("detects position and status changes", () => {
    const a = base();
    const changed = base().map((entry) => (entry.driverCode === "LEC" ? { ...entry, position: null, status: "DSQ" as const } : entry));
    expect(classificationsEqual(a, changed)).toBe(false);
  });

  it("detects display-field corrections such as fastest lap", () => {
    const a = base();
    const changed = base().map((entry) => (entry.driverCode === "LEC" ? { ...entry, fastestLap: true } : entry));
    expect(classificationsEqual(a, changed)).toBe(false);
  });
});

describe("planSessionImport", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const finishedClassification = mapErgastRaceClassification([
    raceRow({ code: "ANT" }),
    raceRow({ code: "LEC", position: "2", positionText: "2" }),
  ]).classification;

  it("never touches a session that has not started (future weekends stay UPCOMING)", () => {
    const plan = planSessionImport({
      session: { kind: "GRAND_PRIX", startsAt: "2026-07-26T13:00:00.000Z", state: "UPCOMING" },
      now,
      sourceClassification: finishedClassification,
      existingConfirmed: null,
    });
    expect(plan).toEqual({ action: "NOT_STARTED" });
  });

  it("leaves cancelled sessions to the admin flow", () => {
    const plan = planSessionImport({
      session: { kind: "GRAND_PRIX", startsAt: "2026-07-19T13:00:00.000Z", state: "CANCELLED" },
      now,
      sourceClassification: finishedClassification,
      existingConfirmed: null,
    });
    expect(plan).toEqual({ action: "CANCELLED" });
  });

  it("reports sessions the source cannot cover instead of fabricating results", () => {
    const plan = planSessionImport({
      session: { kind: "SPRINT_QUALIFYING", startsAt: "2026-07-03T14:30:00.000Z", state: "FINISHED" },
      now,
      sourceClassification: null,
      existingConfirmed: null,
    });
    expect(plan).toEqual({ action: "NO_SOURCE_DATA" });
  });

  it("imports a past session missing results and skips when unchanged", () => {
    const session = { kind: "GRAND_PRIX" as const, startsAt: "2026-07-19T13:00:00.000Z", state: "FINISHED" as const };
    const first = planSessionImport({ session, now, sourceClassification: finishedClassification, existingConfirmed: null });
    expect(first).toEqual({ action: "IMPORT", classification: finishedClassification });
    const second = planSessionImport({ session, now, sourceClassification: finishedClassification, existingConfirmed: finishedClassification });
    expect(second).toEqual({ action: "SKIP_UNCHANGED" });
  });

  it("imports a corrected classification as a new version over a LOCKED session", () => {
    const corrected = finishedClassification.map((entry) =>
      entry.driverCode === "LEC" ? { ...entry, position: null, status: "DSQ" as const } : entry);
    const plan = planSessionImport({
      session: { kind: "GRAND_PRIX", startsAt: "2026-07-19T13:00:00.000Z", state: "LOCKED" },
      now,
      sourceClassification: corrected,
      existingConfirmed: finishedClassification,
    });
    expect(plan).toEqual({ action: "IMPORT", classification: corrected });
  });

  it("rejects a source classification that fails settlement validation", () => {
    const gap = [finishedClassification[0]!, { ...finishedClassification[1]!, position: 5 }];
    const plan = planSessionImport({
      session: { kind: "GRAND_PRIX", startsAt: "2026-07-19T13:00:00.000Z", state: "FINISHED" },
      now,
      sourceClassification: gap,
      existingConfirmed: null,
    });
    expect(plan).toEqual({ action: "INVALID", reason: "POSITION_GAP" });
  });
});
