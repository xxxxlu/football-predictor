import { AuthError } from "@football-predictor/domain";
import { z } from "zod";
import { sourceKey } from "./runtime";

const registerSchema = z.object({
  username: z.string(),
  password: z.string(),
  ageConfirmed: z.literal(true),
  nonCashTermsAccepted: z.literal(true),
});
const loginSchema = z.object({ username: z.string(), password: z.string() });
const recoverySchema = z.object({ username: z.string(), recoveryCode: z.string().min(1), newPassword: z.string() });
const passwordChangeSchema = z.object({ currentPassword: z.string(), newPassword: z.string() });
const reauthSchema = z.object({ password: z.string() });

interface AuthService {
  register(input: { username: string; password: string; isAdultConfirmed: boolean; nonCashRulesVersion: string }): Promise<{ userId: string; username: string; recoveryCode: string }>;
  login(input: { username: string; password: string; sourceKey: string }): Promise<{ sessionToken: string; expiresAt: Date; userId: string; mustChangePassword: boolean }>;
  logout(sessionToken: string): Promise<void>;
  recover(input: { username: string; recoveryCode: string; newPassword: string; sourceKey: string }): Promise<{ recoveryCode: string }>;
  authenticate(sessionToken: string, allowPasswordChange?: boolean): Promise<{ id: string; usernameCanonical: string; status: string; isSuperAdmin: boolean; mustChangePassword: boolean } | null>;
  changePassword(input: { sessionToken: string; currentPassword: string; newPassword: string }): Promise<{ sessionToken: string; expiresAt: Date; mustChangePassword: false }>;
  reauthenticate(input: { sessionToken: string; password: string }): Promise<{ proofToken: string; expiresAt: Date }>;
}

export function createAuthHandlers(service: AuthService, options: { rulesVersion: string; secureCookie: boolean }) {
  return {
    register: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const input = registerSchema.parse(await request.json());
      const result = await service.register({
        username: input.username,
        password: input.password,
        isAdultConfirmed: input.ageConfirmed,
        nonCashRulesVersion: options.rulesVersion,
      });
      return json({ data: result }, 201);
    }),
    login: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const input = loginSchema.parse(await request.json());
      const result = await service.login({ ...input, sourceKey: sourceKey(request) });
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
      return json({ data: { user: { id: account.id, username: account.usernameCanonical, status: account.status, isSuperAdmin: account.isSuperAdmin, mustChangePassword: account.mustChangePassword } } });
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

function readCookie(header: string | null, name: string) {
  for (const pair of header?.split(";") ?? []) {
    const [key, ...parts] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function readSessionToken(request: Request) {
  return readCookie(request.headers.get("cookie"), "fp_session");
}

export function readReauthProof(request: Request) { return readCookie(request.headers.get("cookie"), "fp_reauth"); }

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AuthError("INVALID_ORIGIN", 403, "Reload this page and try again.");
}
