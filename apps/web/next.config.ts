import type { NextConfig } from "next";
import { securityHeaders } from "./security-headers";

const nextConfig: NextConfig = {
  async headers() {
    const privateHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }];
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "production") },
      ...["/rooms/:path*", "/matches", "/history", "/ledger", "/leaderboard", "/account", "/admin/:path*", "/invite/:path*"].map((source) => ({ source, headers: privateHeaders })),
    ];
  },
};

export default nextConfig;
