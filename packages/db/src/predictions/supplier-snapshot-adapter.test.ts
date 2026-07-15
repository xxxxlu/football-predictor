import { describe, expect, it } from "vitest";
import { mapSupplierSnapshotRow } from "./supplier-snapshot-adapter.js";

const row = {
  marketId: "api-football:101:bookmaker:8:market:1", fixtureId: "api-football:101", marketStatus: "OPEN", fixtureStatus: "SCHEDULED",
  kickoffAt: new Date("2026-07-13T12:00:00Z"), version: "odds-v2", dataAsOf: new Date("2026-07-13T09:55:00Z"), supplier: "API_FOOTBALL",
  supplierFixtureId: "101", bookmakerId: "8", supplierMarketId: "1", outcomes: [{ selection: "HOME", decimalOdds: "2.10" }, { selection: "DRAW", decimalOdds: "3.20" }, { selection: "AWAY", decimalOdds: "3.40" }], sourceVerified: true,
};

describe("supplier snapshot adapter mapping", () => {
  it("maps the immutable snapshot trace without changing decimal strings", () => {
    expect(mapSupplierSnapshotRow(row)).toMatchObject({ id: row.marketId, fixtureId: row.fixtureId, status: "OPEN", snapshot: { version: "odds-v2", outcomes: row.outcomes, supplierFixtureId: 101, bookmakerId: 8, marketId: 1 } });
  });
  it("never exposes a persisted market as open once fixture state is not prematch", () => {
    expect(mapSupplierSnapshotRow({ ...row, fixtureStatus: "LIVE" }).status).toBe("CLOSED");
  });

  it("keeps a verified stored snapshot open while supplier synchronization is paused", () => {
    expect(mapSupplierSnapshotRow({ ...row, syncState: "PAUSED" }).status).toBe("OPEN");
    expect(mapSupplierSnapshotRow({ ...row, syncState: "FAILED" }).status).toBe("OPEN");
  });

  it("does not expose an unverified snapshot as open", () => {
    expect(mapSupplierSnapshotRow({ ...row, sourceVerified: false }).status).toBe("DATA_UNAVAILABLE");
  });

  it("accepts timestamp strings returned by raw postgres queries", () => {
    const mapped = mapSupplierSnapshotRow({
      ...row,
      kickoffAt: "2026-07-13T12:00:00.000Z",
      dataAsOf: "2026-07-13T09:55:00.000Z",
    });
    expect(mapped.kickoffAt).toBe("2026-07-13T12:00:00.000Z");
    expect(mapped.snapshot.dataAsOf).toBe("2026-07-13T09:55:00.000Z");
  });
});
