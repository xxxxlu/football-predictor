import { loadIdentityConfig } from "@football-predictor/config";
import { createAuthHandlers } from "./handlers";
import { getIdentityService } from "./runtime";

export function getAuthHandlers() {
  const config = loadIdentityConfig(process.env);
  return createAuthHandlers(getIdentityService(), {
    rulesVersion: config.rulesVersion,
    secureCookie: usesSecureSessionCookie(process.env.NODE_ENV),
  });
}

export function usesSecureSessionCookie(nodeEnv: string | undefined) {
  return nodeEnv === "production";
}
