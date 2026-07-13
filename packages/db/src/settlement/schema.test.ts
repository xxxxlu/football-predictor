import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("0005 settlement migration", () => {
  it("adds confirmed results, idempotent operations, immutable settlements and reversal ledger fields", async () => {
    const sql = await readFile(new URL("../../migrations/0005_settlement.sql", import.meta.url), "utf8");
    expect(sql).toContain('"result_confirmed" boolean');
    expect(sql).toContain('"result_version" text');
    expect(sql).toContain('"prediction"."settlements"');
    expect(sql).toContain('"prediction"."settlement_operations"');
    expect(sql).toContain('PRIMARY KEY ("ticket_id", "settlement_version", "operation")');
    expect(sql).toContain('"correction_debt_delta_points"');
    expect(sql).toContain('"reverses_ledger_id"');
  });
});
