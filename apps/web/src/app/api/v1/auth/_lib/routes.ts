import { loadIdentityConfig } from "@football-predictor/config";
import { createAuthHandlers } from "./handlers";
import { getIdentityService } from "./runtime";

export function getAuthHandlers() {
  const config = loadIdentityConfig(process.env);
  return createAuthHandlers(getIdentityService(), {
    rulesVersion: config.rulesVersion,
    secureCookie: process.env.NODE_ENV === "production",
  });
}
