import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalJobPayload, supplierJobKey, sanitizeJobFailureDetail } from "./jobs.js";

describe("persistent operations jobs", () => {
  it("extends ops.jobs with immutable retry input and observable failure metadata", async () => {
    const migration = await readFile(new URL("../../migrations/0009_supplier_job_reliability.sql", import.meta.url), "utf8");

    for (const column of ["job_key", "payload", "attempt", "result", "last_error_detail", "run_count"]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ops_jobs_job_key_unique"');
  });

  it("derives the same key for semantically identical payloads", () => {
    const left = supplierJobKey("PREMATCH_ODDS", { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 });
    const right = supplierJobKey("PREMATCH_ODDS", { bookmakerId: 8, matchId: "api-football:101", fixtureId: 101 });

    expect(left).toBe(right);
    expect(left).toMatch(/^supplier:PREMATCH_ODDS:[a-f0-9]{64}$/);
    expect(canonicalJobPayload({ z: [3, { b: true, a: null }], a: 1 })).toBe('{"a":1,"z":[3,{"a":null,"b":true}]}');
  });

  it("keeps failure detail useful without persisting multiline or unbounded supplier output", () => {
    expect(sanitizeJobFailureDetail("  upstream\nkey=hidden\t timed out  ")).toBe("upstream key=hidden timed out");
    expect(sanitizeJobFailureDetail("x".repeat(700))).toHaveLength(500);
  });
});
