import { describe, expect, it } from "vitest";

import { AUTH_ERROR_FALLBACK, authErrorMessage } from "./auth-error-messages";

// Locks the login/register/recover error-code → localized-message contract. These are the codes the
// three AuthForm modes can actually receive from /api/v1/auth/{login,register,recover}. If the server
// starts returning a new one, this list forces a matching Chinese message so the UI never falls back to
// the English server message. (Codes traced to their throw sites in the comments.)
const AUTH_FORM_ERROR_CODES = [
  "INVALID_CREDENTIALS", // login: bad username/password or disabled account (service.ts:132)
  "USERNAME_UNAVAILABLE", // register: duplicate username (db repository.ts:38)
  "RULES_CONFIRMATION_REQUIRED", // register: 18+/non-cash rules not confirmed (service.ts:102)
  "INVALID_USERNAME", // register: username fails 3–32 lowercase policy (service.ts:251)
  "INVALID_PASSWORD", // register/recover: password not 12–128 chars (service.ts:262)
  "INVALID_RECOVERY_REQUEST", // recover: wrong recovery code/username (service.ts:219,233)
  "RATE_LIMITED", // login/recover: 15-minute security window (service.ts:243)
  "INVALID_REQUEST", // any: request body fails Zod validation (handlers.ts:98)
  "INVALID_ORIGIN", // any mutation: same-origin/CSRF guard (request-origin.ts:28)
];

const CHINESE = /[一-鿿]/;

describe("authErrorMessage", () => {
  it("maps every login/register/recover error code to a specific localized message (never the fallback)", () => {
    for (const code of AUTH_FORM_ERROR_CODES) {
      const message = authErrorMessage(code);
      expect(message, `no localized message mapped for ${code}`).not.toEqual(AUTH_ERROR_FALLBACK);
      expect(CHINESE.test(message), `message for ${code} is not Chinese: ${message}`).toBe(true);
    }
  });

  it("falls back to a Chinese generic for unknown codes — never leaks the English server message", () => {
    // Regression guard for the i18n bug: an unmapped code (incl. INTERNAL_ERROR) must resolve to the
    // Chinese fallback, not to the API's English `error.message`.
    expect(authErrorMessage("INTERNAL_ERROR")).toEqual(AUTH_ERROR_FALLBACK);
    expect(authErrorMessage("SOME_FUTURE_CODE")).toEqual(AUTH_ERROR_FALLBACK);
    expect(authErrorMessage(undefined)).toEqual(AUTH_ERROR_FALLBACK);
    expect(authErrorMessage(null)).toEqual(AUTH_ERROR_FALLBACK);
    expect(authErrorMessage("")).toEqual(AUTH_ERROR_FALLBACK);
    expect(CHINESE.test(AUTH_ERROR_FALLBACK)).toBe(true);
  });
});
