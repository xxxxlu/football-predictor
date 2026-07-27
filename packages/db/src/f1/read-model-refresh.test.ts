import { describe, expect, it, vi } from "vitest";
import { refreshF1ReadModelIfDue } from "./read-model-refresh.js";

describe("refreshF1ReadModelIfDue", () => {
  const now = new Date("2026-07-27T00:00:00.000Z");

  it("skips the upstream request when another instance owns the interval claim", async () => {
    const createSync = vi.fn();
    await expect(refreshF1ReadModelIfDue({
      databaseUrl: "postgres://example.test/pulse", season: 2026, minimumIntervalMs: 300_000,
      now: () => now, claim: async () => false, createSync,
    })).resolves.toEqual({ attempted: false });
    expect(createSync).not.toHaveBeenCalled();
  });

  it("syncs once after a successful claim and always releases the connection", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn().mockResolvedValue({ imported: 2, unchanged: 3, noSource: 0, notStarted: 4, cancelled: 0, invalid: 0, standingsUpdated: 22 });
    const createSync = vi.fn(() => ({ sync, close }));
    const outcome = await refreshF1ReadModelIfDue({
      databaseUrl: "postgres://example.test/pulse", season: 2026, baseUrl: "https://source.test/ergast", minimumIntervalMs: 300_000,
      now: () => now, claim: async () => true, createSync,
    });
    expect(outcome).toMatchObject({ attempted: true, summary: { imported: 2, standingsUpdated: 22 } });
    expect(createSync).toHaveBeenCalledWith("postgres://example.test/pulse", expect.objectContaining({ season: 2026, baseUrl: "https://source.test/ergast", now: expect.any(Function) }));
    expect(close).toHaveBeenCalledOnce();
  });
});
