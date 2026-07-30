import { describe, expect, it, vi } from "vitest";
import { AuthError } from "@pulse/domain";
import { createAuthHandlers } from "./handlers.js";

function request(path: string, body?: unknown, cookie?: string) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup() {
  const service = {
    register: vi.fn().mockResolvedValue({ userId: "user-1", username: "alice", recoveryCode: "FP-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789" }),
    login: vi.fn().mockResolvedValue({ sessionToken: "opaque-token", expiresAt: new Date("2026-08-12T10:00:00Z"), userId: "user-1", mustChangePassword: false }),
    logout: vi.fn().mockResolvedValue(undefined),
    recover: vi.fn().mockResolvedValue({ recoveryCode: "FP-NEW1-NEW2-NEW3-NEW4-NEW5-NEW6-NEW7-NEW8" }),
    authenticate: vi.fn(),
    changePassword: vi.fn().mockResolvedValue({ sessionToken: "rotated-token", expiresAt: new Date("2026-08-12T10:00:00Z"), mustChangePassword: false }),
    reauthenticate: vi.fn().mockResolvedValue({ proofToken: "proof-token", expiresAt: new Date("2026-07-13T10:05:00Z") }),
  };
  return { service, handlers: createAuthHandlers(service, { rulesVersion: "rules-2026-07", secureCookie: true }) };
}

describe("auth HTTP handlers", () => {
  it("maps the frontend registration contract to versioned domain consent", async () => {
    const { handlers, service } = setup();
    const response = await handlers.register(request("/api/v1/auth/register", { username: "alice", password: "correct-horse-123", ageConfirmed: true, nonCashTermsAccepted: true }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { recoveryCode: expect.stringMatching(/^FP-/) } });
    expect(service.register).toHaveBeenCalledWith(expect.objectContaining({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07", accessContext: expect.objectContaining({ ipAddress: "unknown", deviceClass: "OTHER" }) }));
  });

  it("routes a seeded super-admin to mandatory password change, then rotates the session cookie", async () => {
    const { handlers, service } = setup();
    service.login.mockResolvedValueOnce({ sessionToken: "initial-token", expiresAt: new Date("2026-08-12T10:00:00Z"), userId: "admin-1", mustChangePassword: true });
    const login = await handlers.login(request("/api/v1/auth/login", { username: "ops_admin", password: "initial-password-123" }));
    expect(await login.json()).toEqual({ data: { redirectTo: "/change-password", mustChangePassword: true } });

    const changed = await handlers.changePassword(request("/api/v1/auth/change-password", { currentPassword: "initial-password-123", newPassword: "rotated-password-456" }, "fp_session=initial-token"));
    expect(service.changePassword).toHaveBeenCalledWith({ sessionToken: "initial-token", currentPassword: "initial-password-123", newPassword: "rotated-password-456" });
    expect(changed.headers.get("set-cookie")).toContain("fp_session=rotated-token");
  });

  it("stores a five-minute re-auth proof in a separate HttpOnly cookie", async () => {
    const { handlers } = setup();
    const response = await handlers.reauthenticate(request("/api/v1/auth/reauthenticate", { password: "rotated-password-456" }, "fp_session=opaque-token"));
    expect(response.headers.get("set-cookie")).toContain("fp_reauth=proof-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await response.json()).toEqual({ data: { verified: true, expiresAt: "2026-07-13T10:05:00.000Z" } });
  });

  it("sets and clears an HttpOnly session cookie", async () => {
    const { handlers, service } = setup();
    const login = await handlers.login(request("/api/v1/auth/login", { username: "alice", password: "correct-horse-123" }));
    expect(await login.json()).toEqual({ data: { redirectTo: "/rooms", mustChangePassword: false } });
    expect(login.headers.get("set-cookie")).toContain("fp_session=opaque-token");
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(login.headers.get("set-cookie")).toContain("Secure");

    const logout = await handlers.logout(request("/api/v1/auth/logout", undefined, "fp_session=opaque-token"));
    expect(service.logout).toHaveBeenCalledWith("opaque-token");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not mark a local HTTP development cookie as Secure", async () => {
    const service = setup().service;
    const handlers = createAuthHandlers(service, { rulesVersion: "rules-2026-07", secureCookie: false });
    const login = await handlers.login(request("/api/v1/auth/login", { username: "alice", password: "correct-horse-123" }));

    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("validates same-origin against the browser Host header instead of Next's canonical request URL", async () => {
    const { handlers } = setup();
    const response = await handlers.login(new Request("http://localhost:3001/api/v1/auth/login", {
      method: "POST",
      headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct-horse-123" }),
    }));

    expect(response.status).toBe(200);
  });

  it("returns a stable error envelope without sensitive details", async () => {
    const { handlers, service } = setup();
    service.login.mockRejectedValueOnce(new AuthError("INVALID_CREDENTIALS", 401, "Check the username and password, then try again."));
    const response = await handlers.login(request("/api/v1/auth/login", { username: "alice", password: "wrong-password-123" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "INVALID_CREDENTIALS", message: "Check the username and password, then try again." } });
  });

  it("maps recovery and never creates a session implicitly", async () => {
    const { handlers, service } = setup();
    const response = await handlers.recover(request("/api/v1/auth/recover", { username: "alice", recoveryCode: "old-code", newPassword: "new-correct-horse-456" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { recoveryCode: expect.stringMatching(/^FP-/) } });
    expect(service.recover).toHaveBeenCalledWith(expect.objectContaining({ username: "alice", recoveryCode: "old-code", newPassword: "new-correct-horse-456" }));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("resolves an active cookie without exposing credential hashes", async () => {
    const { handlers, service } = setup();
    service.authenticate.mockResolvedValueOnce({ id: "user-1", usernameCanonical: "alice", status: "ACTIVE", isSuperAdmin: false, mustChangePassword: false, operatorRoles: [], passwordHash: "secret", recoveryCodeHash: "secret" });
    const response = await handlers.session(new Request("https://example.test/api/v1/auth/session", { headers: { cookie: "fp_session=opaque-token" } }));
    const payload = await response.json();
    expect(payload).toEqual({ data: { user: { id: "user-1", username: "alice", status: "ACTIVE", isSuperAdmin: false, mustChangePassword: false, operatorRoles: [] } } });
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
  });

  it("reports the held operator duties so the shell can hide entries it cannot use", async () => {
    const { handlers, service } = setup();
    service.authenticate.mockResolvedValueOnce({ id: "user-2", usernameCanonical: "bob", status: "ACTIVE", isSuperAdmin: false, mustChangePassword: false, operatorRoles: ["OPERATIONS_ADMIN"] });
    const operator = await (await handlers.session(new Request("https://example.test/api/v1/auth/session", { headers: { cookie: "fp_session=opaque-token" } }))).json();
    expect(operator.data.user.operatorRoles).toEqual(["OPERATIONS_ADMIN"]);

    service.authenticate.mockResolvedValueOnce({ id: "user-3", usernameCanonical: "root", status: "ACTIVE", isSuperAdmin: true, mustChangePassword: false, operatorRoles: [] });
    const admin = await (await handlers.session(new Request("https://example.test/api/v1/auth/session", { headers: { cookie: "fp_session=opaque-token" } }))).json();
    expect(admin.data.user.operatorRoles).toEqual(["SUPER_ADMIN"]);
  });
});
