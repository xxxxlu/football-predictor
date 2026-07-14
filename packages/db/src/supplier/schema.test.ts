import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("0004 supplier migration", () => {
  it("creates atomic budgets and versioned fixture/market cache tables", async () => {
    const migration = await readFile(new URL("../../migrations/0004_supplier.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "supplier"');
    for (const table of ["request_budgets", "fixtures", "fixture_snapshots", "markets", "odds_snapshots", "live_snapshots"]) {
      expect(migration).toContain(`"supplier"."${table}"`);
    }
    expect(migration).toContain('PRIMARY KEY ("market_id", "version")');
    expect(migration).toContain('"total_used" <= 95');
    expect(migration).toContain('"outcomes" jsonb');
    expect(migration).toContain('"source_verified" boolean');
  });
});

describe("0010 multi-source fixture identity migration", () => {
  it("allows different suppliers to use the same numeric fixture id", async () => {
    const migration = await readFile(new URL("../../migrations/0010_multi_source_fixture_identity.sql", import.meta.url), "utf8");
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "fixtures_supplier_fixture_id_key"');
    expect(migration).toContain('UNIQUE ("supplier", "supplier_fixture_id")');
  });
});
