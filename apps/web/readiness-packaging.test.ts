import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("readiness deployment packaging", () => {
  it("includes the database migration manifest in the readiness route trace", () => {
    expect(nextConfig.outputFileTracingRoot).toBeTruthy();
    expect(nextConfig.outputFileTracingIncludes?.["/api/health/ready"]).toContain(
      "../../packages/db/migrations/*.sql",
    );
  });
});
