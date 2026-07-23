import { describe, expect, it } from "vitest";
import { describeLineupStatus, lineupViewFromPayload, positionRows, type LineupPlayerView } from "./lineup-types.js";

function apiPlayer(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, name: "球员", number: 9, position: "FWD", positionRaw: "Striker", grid: "4:1", photoUrl: null, starter: true, status: "STARTING", ...overrides };
}

describe("lineupViewFromPayload", () => {
  it("splits a confirmed team into starters and bench", () => {
    const view = lineupViewFromPayload({
      data: {
        status: "CONFIRMED",
        stale: false,
        confirmed: true,
        dataAsOf: "2026-07-19T18:00:00.000Z",
        capturedAt: "2026-07-19T18:00:01.000Z",
        home: {
          teamId: 10,
          name: "英格兰",
          logoUrl: null,
          primaryColor: "#0b2a5b",
          formation: "4-3-3",
          coach: "教练",
          players: [apiPlayer({ id: 1, starter: true }), apiPlayer({ id: 2, starter: false, status: "BENCH" })],
        },
        away: null,
      },
    });
    expect(view?.status).toBe("CONFIRMED");
    expect(view?.home?.starters).toHaveLength(1);
    expect(view?.home?.bench).toHaveLength(1);
    expect(view?.home?.formation).toBe("4-3-3");
    expect(view?.away).toBeNull();
  });

  it("drops malformed players instead of rendering them", () => {
    const view = lineupViewFromPayload({
      data: {
        status: "CONFIRMED", stale: false, confirmed: true, dataAsOf: null, capturedAt: null, away: null,
        home: { teamId: 10, name: "英格兰", logoUrl: null, primaryColor: null, formation: null, coach: null, players: [apiPlayer(), { id: "x", name: "坏" }, { name: "无id" }] },
      },
    });
    expect(view?.home?.starters).toHaveLength(1);
  });

  it("rejects unknown statuses and non-envelopes", () => {
    expect(lineupViewFromPayload({ data: { status: "WHATEVER" } })).toBeNull();
    expect(lineupViewFromPayload({ data: { status: "" } })).toBeNull();
    expect(lineupViewFromPayload(null)).toBeNull();
    expect(lineupViewFromPayload("oops")).toBeNull();
    expect(lineupViewFromPayload({})).toBeNull();
  });

  it("keeps a pending view with no teams", () => {
    const view = lineupViewFromPayload({ data: { status: "LINEUP_PENDING", stale: false, confirmed: false, dataAsOf: null, capturedAt: null, home: null, away: null } });
    expect(view).toMatchObject({ status: "LINEUP_PENDING", home: null, away: null });
  });

  it("coerces an out-of-range position to UNKNOWN rather than dropping the player", () => {
    const view = lineupViewFromPayload({
      data: {
        status: "CONFIRMED", stale: false, confirmed: true, dataAsOf: null, capturedAt: null, away: null,
        home: { teamId: 10, name: "英格兰", logoUrl: null, primaryColor: null, formation: null, coach: null, players: [apiPlayer({ position: "SWEEPER" })] },
      },
    });
    expect(view?.home?.starters[0]?.position).toBe("UNKNOWN");
  });
});

describe("positionRows", () => {
  const starters: LineupPlayerView[] = [
    { id: 1, name: "GK", number: 1, position: "GK", positionRaw: null, grid: "1:1", photoUrl: null, starter: true, status: "STARTING" },
    { id: 3, name: "RB", number: 2, position: "DEF", positionRaw: null, grid: "2:3", photoUrl: null, starter: true, status: "STARTING" },
    { id: 2, name: "LB", number: 3, position: "DEF", positionRaw: null, grid: "2:1", photoUrl: null, starter: true, status: "STARTING" },
    { id: 4, name: "ST", number: 9, position: "FWD", positionRaw: null, grid: "4:1", photoUrl: null, starter: true, status: "STARTING" },
  ];

  it("orders lines GK→FWD and sorts within a line by grid column", () => {
    const rows = positionRows(starters);
    expect(rows.map((row) => row.position)).toEqual(["GK", "DEF", "FWD"]); // MID line dropped (empty)
    expect(rows[1]?.players.map((player) => player.name)).toEqual(["LB", "RB"]); // 2:1 before 2:3
  });

  it("produces no rows for an empty starting eleven", () => {
    expect(positionRows([])).toEqual([]);
  });
});

describe("describeLineupStatus", () => {
  it("labels each status distinctly", () => {
    expect(describeLineupStatus({ status: "CONFIRMED", confirmed: true }).tone).toBe("ok");
    expect(describeLineupStatus({ status: "EXPECTED", confirmed: false }).tone).toBe("warn");
    expect(describeLineupStatus({ status: "DATA_UNAVAILABLE", confirmed: false }).tone).toBe("error");
    expect(describeLineupStatus({ status: "LINEUP_PENDING", confirmed: false }).tone).toBe("info");
  });

  it("reflects the underlying confirmation basis when stale", () => {
    expect(describeLineupStatus({ status: "DATA_STALE", confirmed: true }).detail).toContain("官方首发");
    expect(describeLineupStatus({ status: "DATA_STALE", confirmed: false }).detail).toContain("预计阵容");
  });
});
