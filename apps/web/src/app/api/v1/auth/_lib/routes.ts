import { loadIdentityConfig } from "@pulse/config";
import { createAuthHandlers } from "./handlers";
import { getIdentityService } from "./runtime";
import { privacyRepository } from "../../_lib/privacy-runtime";

export function getAuthHandlers() {
  const config = loadIdentityConfig(process.env);
  return createAuthHandlers(getIdentityService(), {
    rulesVersion: config.rulesVersion,
    secureCookie: usesSecureSessionCookie(process.env.APP_ENV),
    privacyRecorder: privacyRepository(),
  });
}

// Keyed on APP_ENV, not NODE_ENV: `next start` always runs with
// NODE_ENV=production, so CI's production-build E2E server (APP_ENV=test,
// plain http) must still be able to set the session cookie. Real deployments
// (render.yaml) set APP_ENV=production and keep Secure. Same policy as the
// moderation handlers.
export function usesSecureSessionCookie(appEnv: string | undefined) {
  return appEnv === "production";
}
