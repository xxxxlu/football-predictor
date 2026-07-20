import { describe, expect, it, vi } from "vitest";
import { LineupSyncService, lineupRefreshDecision } from "./lineups.js";

const fixture = { id: "api-football:10", supplierFixtureId: 10, status: "SCHEDULED" as const, kickoffAt: "2026-07-20T12:00:00.000Z" };
const now = new Date("2026-07-20T10:30:00.000Z");

describe("lineup refresh policy", () => {
  it("refreshes for the first time inside the two-hour window", () => {
    expect(lineupRefreshDecision({ fixture, now }).due).toBe(true);
    expect(lineupRefreshDecision({ fixture, now }).intervalMs).toBe(15 * 60_000);
  });

  it("does not refresh a distant fixture every scheduler tick", () => {
    const distant = { ...fixture, kickoffAt: "2026-07-21T12:00:00.000Z" };
    expect(lineupRefreshDecision({ fixture: distant, now, lastAttemptAt: new Date("2026-07-20T10:00:00.000Z") }).due).toBe(false);
  });

  it("refreshes live fixtures on the shorter interval", () => {
    const live = { ...fixture, status: "LIVE" as const };
    expect(lineupRefreshDecision({ fixture: live, now, lastAttemptAt: new Date("2026-07-20T10:24:00.000Z") }).due).toBe(true);
  });

  it("keeps cached lineup when supplier has not published it", async () => {
    const cached = { fixtureId: fixture.id, supplierFixtureId: 10, status: "CONFIRMED" as const, dataAsOf: now.toISOString(), capturedAt: now.toISOString(), home: {} as never, away: {} as never };
    const repository = { getLineup: vi.fn().mockResolvedValue(cached), saveLineup: vi.fn() };
    const gateway = { fetchLineups: vi.fn().mockResolvedValue({ data: null }) };
    const service = new LineupSyncService({ repository, gateway, now: () => now });
    const result = await service.refresh({ fixture });
    expect(result.snapshot).toBe(cached);
    expect(repository.saveLineup).not.toHaveBeenCalled();
  });
});
