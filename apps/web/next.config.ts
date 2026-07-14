import type { NextConfig } from "next";
import { resolve } from "node:path";

// Security headers are defined inline here so that `next start` in the production
// image can load this config without resolving a sibling module. Next transpiles
// next.config.ts at startup and leaves relative imports as runtime requires; a
// sibling `.ts` is neither shipped in the runtime image nor loadable via require,
// which crashes the server on boot. Keeping the policy self-contained avoids that.
export type Header = { key: string; value: string };

export function securityHeaders(production: boolean): Header[] {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"])];
  const connectSrc = ["'self'", ...(production ? [] : ["ws:", "wss:"])];
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers: Header[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/health/ready": ["../../packages/db/migrations/*.sql"],
  },
  async headers() {
    const privateHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }];
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "production") },
      ...["/rooms/:path*", "/matches", "/history", "/ledger", "/leaderboard", "/account", "/admin/:path*", "/invite/:path*"].map((source) => ({ source, headers: privateHeaders })),
    ];
  },
};

export default nextConfig;
