import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("private route indexing policy", () => {
  it("sends noindex headers for every private product surface", async () => {
    const rules = await nextConfig.headers?.();
    const privateSources = ["/rooms/:path*", "/matches", "/history", "/ledger", "/leaderboard", "/account", "/admin/:path*", "/invite/:path*"];
    for (const source of privateSources) {
      const rule = rules?.find((candidate) => candidate.source === source);
      expect(rule?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" });
    }
  });
});
