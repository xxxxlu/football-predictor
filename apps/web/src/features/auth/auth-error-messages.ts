// Localized messages for the auth error codes returned by /api/v1/auth/{login,register,recover}.
//
// The API returns `error.code` VERBATIM and `error.message` = the English developer-facing `action`
// string (AuthError's 3rd arg — see api/v1/auth/_lib/handlers.ts:97). That English message must NEVER
// be shown to a (Chinese) end user, so an unknown code falls back to a Chinese generic here rather
// than to the raw server message. When the server gains a new auth error code, add it below (the
// co-located test enumerates the known codes so the omission is caught).
//
// Code sources: packages/domain/src/identity/service.ts, packages/db/src/identity/repository.ts,
// apps/web/src/app/api/v1/auth/_lib/handlers.ts, apps/web/src/app/api/v1/_lib/request-origin.ts.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "用户名或密码不正确。", // login (service.ts:132), reauth/change-password
  USERNAME_UNAVAILABLE: "这个用户名已被使用，请换一个。", // register duplicate (repository.ts:38)
  RULES_CONFIRMATION_REQUIRED: "请先确认已满 18 岁并接受虚拟积分规则。", // register (service.ts:102)
  INVALID_USERNAME: "用户名需为 3–32 位小写字母、数字或下划线。", // register (service.ts:251)
  INVALID_PASSWORD: "密码需为 12–128 个字符。", // register / recover (service.ts:262)
  INVALID_RECOVERY_REQUEST: "恢复码或用户名不正确，或请稍后再试。", // recover (service.ts:219,233)
  RATE_LIMITED: "尝试次数过多，请稍后再试。", // login / recover (service.ts:243)
  INVALID_REQUEST: "请检查填写内容后重试。", // Zod / parse failure (handlers.ts:98)
  INVALID_ORIGIN: "请求来源校验失败，请刷新页面后重试。", // CSRF same-origin guard (request-origin.ts:28)
};

// Shown for any code not mapped above (incl. INTERNAL_ERROR / undefined). Deliberately Chinese so the
// English server message never leaks to the UI.
export const AUTH_ERROR_FALLBACK = "暂时无法完成，请稍后重试。";

export function authErrorMessage(code: string | null | undefined): string {
  return (code && AUTH_ERROR_MESSAGES[code]) || AUTH_ERROR_FALLBACK;
}

// Exposed for the contract test.
export const KNOWN_AUTH_ERROR_CODES = Object.keys(AUTH_ERROR_MESSAGES);
