import { AuthError } from "@pulse/domain";
import { z } from "zod";
import { assertSameOrigin } from "../../_lib/request-origin";
import { accessContext, sourceKey } from "./runtime";
import type { AccessContext } from "@pulse/domain";
import { readCookie } from "./session-token";
import { deviceInfoSchema, preferencesSchema, type DeviceInfoInput, type PreferencesInput } from "../../_lib/privacy-input";
export { readReauthProof, readSessionToken } from "./session-token";

const LOGIN_PRIVACY_POLICY_VERSION = "privacy-2026-08-07";

const registerSchema = z.object({
  username: z.string(),
  password: z.string(),
  ageConfirmed: z.literal(true),
  nonCashTermsAccepted: z.literal(true),
});
const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  privacyConsent: z.literal(true),
  deviceInfo: deviceInfoSchema,
  preferences: preferencesSchema,
}).strict();
const recoverySchema = z.object({ username: z.string(), recoveryCode: z.string().min(1), newPassword: z.string() });
const passwordChangeSchema = z.object({ currentPassword: z.string(), newPassword: z.string() });
const reauthSchema = z.object({ password: z.string() });

interface AuthService {
  register(input: { username: string; password: string; isAdultConfirmed: boolean; nonCashRulesVersion: string; accessContext?: AccessContext }): Promise<{ userId: string; username: string; recoveryCode: string }>;
  login(input: { username: string; password: string; sourceKey: string; accessContext?: AccessContext }): Promise<{ sessionToken: string; expiresAt: Date; userId: string; mustChangePassword: boolean }>;
  logout(sessionToken: string): Promise<void>;
  recover(input: { username: string; recoveryCode: string; newPassword: string; sourceKey: string }): Promise<{ recoveryCode: string }>;
  authenticate(sessionToken: string, allowPasswordChange?: boolean): Promise<{ id: string; usernameCanonical: string; status: string; isSuperAdmin: boolean; mustChangePassword: boolean; operatorRoles?: string[] } | null>;
  changePassword(input: { sessionToken: string; currentPassword: string; newPassword: string }): Promise<{ sessionToken: string; expiresAt: Date; mustChangePassword: false }>;
  reauthenticate(input: { sessionToken: string; password: string }): Promise<{ proofToken: string; expiresAt: Date }>;
}

interface LoginPrivacyRecorder {
  recordLoginConsent(
    userId: string,
    deviceInfo: DeviceInfoInput,
    preferences: PreferencesInput,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<unknown>;
}

export function createAuthHandlers(service: AuthService, options: { rulesVersion: string; secureCookie: boolean; privacyRecorder: LoginPrivacyRecorder }) {
  return {
    register: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const input = registerSchema.parse(await request.json());
      const result = await service.register({
        username: input.username,
        password: input.password,
        isAdultConfirmed: input.ageConfirmed,
        nonCashRulesVersion: options.rulesVersion,
        accessContext: accessContext(request),
      });
      return json({ data: result }, 201);
    }),
    login: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const input = loginSchema.parse(await request.json());
      const context = accessContext(request);
      const result = await service.login({ username: input.username, password: input.password, sourceKey: sourceKey(request), accessContext: context });
      try {
        await options.privacyRecorder.recordLoginConsent(
          result.userId,
          input.deviceInfo,
          { ...input.preferences, privacyPolicyVersion: LOGIN_PRIVACY_POLICY_VERSION },
          context.ipAddress,
          context.userAgent,
        );
      } catch (error) {
        // Do not leave an undisclosed active session when consent persistence fails.
        await service.logout(result.sessionToken).catch(() => undefined);
        throw error;
      }
      const response = json({ data: { redirectTo: result.mustChangePassword ? "/change-password" : "/rooms", mustChangePassword: result.mustChangePassword } });
      response.headers.append("set-cookie", sessionCookie(result.sessionToken, result.expiresAt, options.secureCookie));
      return response;
    }),
    logout: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const token = readCookie(request.headers.get("cookie"), "fp_session");
      if (token) await service.logout(token);
      const response = json({ data: { loggedOut: true } });
      response.headers.append("set-cookie", clearSessionCookie(options.secureCookie));
      return response;
    }),
    recover: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const input = recoverySchema.parse(await request.json());
      const result = await service.recover({ ...input, sourceKey: sourceKey(request) });
      return json({ data: result });
    }),
    changePassword: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const sessionToken = readCookie(request.headers.get("cookie"), "fp_session");
      if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      const input = passwordChangeSchema.parse(await request.json());
      const result = await service.changePassword({ sessionToken, ...input });
      const response = json({ data: { redirectTo: "/rooms", mustChangePassword: false } });
      response.headers.append("set-cookie", sessionCookie(result.sessionToken, result.expiresAt, options.secureCookie));
      return response;
    }),
    reauthenticate: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const sessionToken = readCookie(request.headers.get("cookie"), "fp_session");
      if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      const input = reauthSchema.parse(await request.json());
      const result = await service.reauthenticate({ sessionToken, password: input.password });
      const response = json({ data: { verified: true, expiresAt: result.expiresAt.toISOString() } });
      response.headers.append("set-cookie", reauthCookie(result.proofToken, result.expiresAt, options.secureCookie));
      return response;
    }),
    session: (request: Request) => execute(async () => {
      const token = readCookie(request.headers.get("cookie"), "fp_session");
      const account = token ? await service.authenticate(token, true) : null;
      if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      // Duties travel with the session read so the app shell can hide entries an
      // operator cannot use. Purely cosmetic — every API authorizes on its own.
      const operatorRoles = [...(account.isSuperAdmin ? ["SUPER_ADMIN"] : []), ...(account.operatorRoles ?? [])];
      return json({ data: { user: { id: account.id, username: account.usernameCanonical, status: account.status, isSuperAdmin: account.isSuperAdmin, mustChangePassword: account.mustChangePassword, operatorRoles } } });
    }),
  };
}

async function execute(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthError) return json({ error: { code: error.code, message: error.action ?? "Request could not be completed." } }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: { code: "INVALID_REQUEST", message: "Check the submitted fields and try again." } }, 422);
    return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, 500);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function sessionCookie(token: string, expiresAt: Date, secure: boolean) {
  return `fp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(secure: boolean) {
  return `fp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function reauthCookie(token: string, expiresAt: Date, secure: boolean) {
  return `fp_reauth=${encodeURIComponent(token)}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}
