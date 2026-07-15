import { describe, expect, it } from "vitest";
import {
  AuthError,
  IdentityService,
  type AuthAttemptKind,
  type AccessContext,
  type IdentityAccount,
  type IdentityRepository,
  type PasswordHasher,
  type TokenFactory,
} from "./service.js";

class MemoryIdentityRepository implements IdentityRepository {
  accounts = new Map<string, IdentityAccount>();
  sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null; lastSeenAt: Date }>();
  failures: Array<{ kind: AuthAttemptKind; accountKey: string; sourceKey: string; occurredAt: Date }> = [];
  proofs = new Map<string, { userId: string; sessionTokenHash: string; expiresAt: Date }>();
  adminEvents: Array<{ actorUserId: string; targetUserId: string; action: string }> = [];
  accessEvents: Array<AccessContext & { userId: string; kind: "REGISTER" | "LOGIN"; occurredAt: Date }> = [];

  async createRegisteredAccount(account: IdentityAccount): Promise<void> {
    if (this.accounts.has(account.usernameCanonical)) throw new AuthError("USERNAME_UNAVAILABLE", 409);
    this.accounts.set(account.usernameCanonical, account);
  }
  async findAccountByUsername(usernameCanonical: string) { return this.accounts.get(usernameCanonical) ?? null; }
  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date }) {
    this.sessions.set(input.tokenHash, { userId: input.userId, expiresAt: input.expiresAt, revokedAt: null, lastSeenAt: new Date(input.expiresAt.getTime() - 86_400_000) });
  }
  async revokeSession(tokenHash: string, revokedAt: Date) {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = revokedAt;
  }
  async findActiveSession(tokenHash: string, now: Date, superAdminIdleSince: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const account = [...this.accounts.values()].find((candidate) => candidate.id === session.userId);
    if (account?.status !== "ACTIVE") return null;
    if (account.isSuperAdmin && session.lastSeenAt <= superAdminIdleSince) { session.revokedAt = now; return null; }
    session.lastSeenAt = now;
    return account;
  }
  async changePassword(input: { userId: string; currentPasswordHash: string; passwordHash: string; changedAt: Date }) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === input.userId);
    if (!account || account.passwordHash !== input.currentPasswordHash) return false;
    account.passwordHash = input.passwordHash;
    account.mustChangePassword = false;
    for (const session of this.sessions.values()) if (session.userId === input.userId) session.revokedAt = input.changedAt;
    return true;
  }
  async createReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; expiresAt: Date }) {
    this.proofs.set(input.tokenHash, { userId: input.userId, sessionTokenHash: input.sessionTokenHash, expiresAt: input.expiresAt });
  }
  async verifyReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; now: Date }) {
    const proof = this.proofs.get(input.tokenHash);
    return Boolean(proof && proof.userId === input.userId && proof.sessionTokenHash === input.sessionTokenHash && proof.expiresAt > input.now);
  }
  async setNormalAccountStatus(input: { actorUserId: string; targetUserId: string; status: "ACTIVE" | "DISABLED"; changedAt: Date; auditId: string }) {
    const actor = [...this.accounts.values()].find((candidate) => candidate.id === input.actorUserId);
    const target = [...this.accounts.values()].find((candidate) => candidate.id === input.targetUserId);
    if (!actor?.isSuperAdmin || !target || target.isSuperAdmin) return false;
    target.status = input.status;
    if (input.status === "DISABLED") for (const session of this.sessions.values()) if (session.userId === target.id) session.revokedAt = input.changedAt;
    this.adminEvents.push({ actorUserId: actor.id, targetUserId: target.id, action: input.status === "DISABLED" ? "ACCOUNT_DISABLED" : "ACCOUNT_RESTORED" });
    return true;
  }
  async listNormalAccounts() { return [...this.accounts.values()].filter((account) => !account.isSuperAdmin).map(({ id, usernameCanonical, status }) => ({ id, username: usernameCanonical, status })); }
  async recoverAccount(input: { userId: string; expectedRecoveryCodeHash: string; passwordHash: string; recoveryCodeHash: string; recoveredAt: Date }) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === input.userId);
    if (!account) throw new Error("missing account");
    if (account.recoveryCodeHash !== input.expectedRecoveryCodeHash) return false;
    account.passwordHash = input.passwordHash;
    account.recoveryCodeHash = input.recoveryCodeHash;
    for (const session of this.sessions.values()) if (session.userId === input.userId) session.revokedAt = input.recoveredAt;
    return true;
  }
  async countRecentFailures(kind: AuthAttemptKind, accountKey: string, sourceKey: string, since: Date) {
    return this.failures.filter((failure) => failure.kind === kind && failure.occurredAt >= since && (failure.accountKey === accountKey || failure.sourceKey === sourceKey)).length;
  }
  async recordFailure(kind: AuthAttemptKind, accountKey: string, sourceKey: string, occurredAt: Date) {
    this.failures.push({ kind, accountKey, sourceKey, occurredAt });
  }
  async recordSecurityEvent() {}
  async clearFailures(kind: AuthAttemptKind, accountKey: string) {
    this.failures = this.failures.filter((failure) => failure.kind !== kind || failure.accountKey !== accountKey);
  }
  async recordAccessEvent(input: AccessContext & { userId: string; kind: "REGISTER" | "LOGIN"; occurredAt: Date }) { this.accessEvents.push(input); }
  async getAudienceStats() { return { totalUsers: this.accounts.size, locatedUsers: 0, countries: [], regions: [], cities: [], deviceClasses: [], operatingSystems: [], browsers: [] }; }
}

const passwordHasher: PasswordHasher = {
  hash: async (password) => `hash:${password}`,
  verify: async (hash, password) => hash === `hash:${password}`,
};

let tokenSequence = 0;
const tokens: TokenFactory = {
  recoveryCode: () => `RECOVERY-${++tokenSequence}`,
  sessionToken: () => `SESSION-${++tokenSequence}`,
  hash: (value) => `token-hash:${Buffer.from(value).toString("base64url")}`,
};

const now = new Date("2026-07-13T10:00:00.000Z");
function service(repository = new MemoryIdentityRepository()) {
  return { repository, service: new IdentityService(repository, passwordHasher, tokens, () => now, { currentRulesVersion: "rules-2026-07", sessionTtlMs: 86_400_000 }) };
}

describe("IdentityService registration", () => {
  it("creates a normalized account and returns a recovery code only in the command result", async () => {
    const { service: identity, repository } = service();
    const result = await identity.register({ username: "  Alice_01 ", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });

    expect(result.recoveryCode).toMatch(/^RECOVERY-/);
    const account = repository.accounts.get("alice_01");
    expect(account).toMatchObject({ usernameCanonical: "alice_01", passwordHash: "hash:correct-horse-123", acceptedRulesVersion: "rules-2026-07", status: "ACTIVE" });
    expect(account?.recoveryCodeHash).toBe(tokens.hash(result.recoveryCode));
    expect(JSON.stringify(account)).not.toContain(result.recoveryCode);
  });

  it("rejects missing adult/rules consent without creating an account", async () => {
    const { service: identity, repository } = service();
    await expect(identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: false, nonCashRulesVersion: "rules-2026-07" })).rejects.toMatchObject({ code: "RULES_CONFIRMATION_REQUIRED" });
    expect(repository.accounts.size).toBe(0);
  });
});

describe("IdentityService sessions", () => {
  it("logs in with an opaque token, resolves it, and revokes it on logout", async () => {
    const { service: identity } = service();
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    const login = await identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:local" });
    expect(login.sessionToken).toMatch(/^SESSION-/);
    expect((await identity.authenticate(login.sessionToken))?.usernameCanonical).toBe("alice");
    await identity.logout(login.sessionToken);
    expect(await identity.authenticate(login.sessionToken)).toBeNull();
  });

  it("blocks attempts after five failures in the rolling window", async () => {
    const { service: identity } = service();
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(identity.login({ username: "alice", password: "wrong-password-123", sourceKey: "ip:bad" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:bad" })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});

describe("IdentityService super-admin controls", () => {
  it("marks a seeded super-admin login for mandatory password change and rotates every session after the change", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "ops_admin", password: "initial-password-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    const admin = repository.accounts.get("ops_admin")!;
    admin.isSuperAdmin = true;
    admin.mustChangePassword = true;

    const login = await identity.login({ username: "ops_admin", password: "initial-password-123", sourceKey: "ip:ops" });
    expect(login).toMatchObject({ mustChangePassword: true });
    expect(await identity.authenticate(login.sessionToken)).toBeNull();
    expect((await identity.authenticate(login.sessionToken, true))?.mustChangePassword).toBe(true);
    const changed = await identity.changePassword({ sessionToken: login.sessionToken, currentPassword: "initial-password-123", newPassword: "rotated-password-456" });

    expect(await identity.authenticate(login.sessionToken)).toBeNull();
    expect(changed.sessionToken).not.toBe(login.sessionToken);
    expect((await identity.authenticate(changed.sessionToken))?.mustChangePassword).toBe(false);
  });

  it("expires a super-admin session after 30 minutes of inactivity while normal sessions retain their configured TTL", async () => {
    let clock = new Date("2026-07-13T10:00:00.000Z");
    const repository = new MemoryIdentityRepository();
    const identity = new IdentityService(repository, passwordHasher, tokens, () => clock, { currentRulesVersion: "rules-2026-07", sessionTtlMs: 86_400_000, superAdminIdleTimeoutMs: 30 * 60_000 });
    await identity.register({ username: "ops_admin", password: "rotated-password-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    const login = await identity.login({ username: "ops_admin", password: "rotated-password-456", sourceKey: "ip:ops" });
    clock = new Date("2026-07-13T10:31:00.000Z");
    expect(await identity.authenticate(login.sessionToken)).toBeNull();
  });

  it("requires a session-bound five-minute re-auth proof to disable and restore a normal user", async () => {
    let clock = new Date("2026-07-13T10:00:00.000Z");
    const repository = new MemoryIdentityRepository();
    const identity = new IdentityService(repository, passwordHasher, tokens, () => clock, { currentRulesVersion: "rules-2026-07", sessionTtlMs: 86_400_000, reauthTtlMs: 5 * 60_000 });
    await identity.register({ username: "ops_admin", password: "rotated-password-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    const adminLogin = await identity.login({ username: "ops_admin", password: "rotated-password-456", sourceKey: "ip:ops" });
    const userLogin = await identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:user" });

    await expect(identity.setAccountStatus({ actorSessionToken: adminLogin.sessionToken, proofToken: "missing", targetUserId: repository.accounts.get("alice")!.id, status: "DISABLED" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
    const proof = await identity.reauthenticate({ sessionToken: adminLogin.sessionToken, password: "rotated-password-456" });
    await expect(identity.authorizeSuperAdminAction({ sessionToken: adminLogin.sessionToken, proofToken: proof.proofToken })).resolves.toMatchObject({ id: repository.accounts.get("ops_admin")!.id });
    await expect(identity.setAccountStatus({ actorSessionToken: adminLogin.sessionToken, proofToken: proof.proofToken, targetUserId: repository.accounts.get("alice")!.id, status: "DISABLED" })).resolves.toHaveProperty("auditId");
    expect(await identity.authenticate(userLogin.sessionToken)).toBeNull();

    clock = new Date("2026-07-13T10:05:01.000Z");
    await expect(identity.authorizeSuperAdminAction({ sessionToken: adminLogin.sessionToken, proofToken: proof.proofToken })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    await expect(identity.setAccountStatus({ actorSessionToken: adminLogin.sessionToken, proofToken: proof.proofToken, targetUserId: repository.accounts.get("alice")!.id, status: "ACTIVE" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("never permits a super-admin account to be disabled through the product API", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "ops_admin", password: "rotated-password-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "ops_backup", password: "backup-password-789", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    repository.accounts.get("ops_backup")!.isSuperAdmin = true;
    const login = await identity.login({ username: "ops_admin", password: "rotated-password-456", sourceKey: "ip:ops" });
    const proof = await identity.reauthenticate({ sessionToken: login.sessionToken, password: "rotated-password-456" });
    await expect(identity.setAccountStatus({ actorSessionToken: login.sessionToken, proofToken: proof.proofToken, targetUserId: repository.accounts.get("ops_backup")!.id, status: "DISABLED" })).rejects.toMatchObject({ code: "TARGET_NOT_MANAGEABLE" });
  });
});

describe("IdentityService role enforcement", () => {
  it("denies a normal authenticated user every super-admin capability", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "bob", password: "correct-horse-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    const login = await identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:user" });
    const bobId = repository.accounts.get("bob")!.id;

    await expect(identity.listManageableAccounts(login.sessionToken)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.authorizeSuperAdminAction({ sessionToken: login.sessionToken, proofToken: "anything" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.reauthenticate({ sessionToken: login.sessionToken, password: "correct-horse-123" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.setAccountStatus({ actorSessionToken: login.sessionToken, proofToken: "anything", targetUserId: bobId, status: "DISABLED" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(repository.accounts.get("bob")!.status).toBe("ACTIVE");
  });

  it("rejects anonymous or unknown sessions before any super-admin read", async () => {
    const { service: identity } = service();
    await expect(identity.listManageableAccounts("")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(identity.listManageableAccounts("unknown-token")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("never provisions a super-admin through public registration", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "attacker", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    expect(repository.accounts.get("attacker")!.isSuperAdmin).toBe(false);
    const login = await identity.login({ username: "attacker", password: "correct-horse-123", sourceKey: "ip:user" });
    expect((await identity.authenticate(login.sessionToken))?.isSuperAdmin).toBe(false);
  });

  it("lets a ready super-admin read only the normal-account roster", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "ops_admin", password: "rotated-password-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    const login = await identity.login({ username: "ops_admin", password: "rotated-password-456", sourceKey: "ip:ops" });
    const roster = await identity.listManageableAccounts(login.sessionToken);
    expect(roster.users.map((user) => user.username)).toEqual(["alice"]);
    expect(roster.users.some((user) => user.username === "ops_admin")).toBe(false);
  });
});

describe("IdentityService recovery", () => {
  it("rotates the recovery code, changes the password, and revokes every prior session", async () => {
    const { service: identity } = service();
    const registered = await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    const firstSession = await identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:one" });
    const recovered = await identity.recover({ username: "alice", recoveryCode: registered.recoveryCode, newPassword: "new-correct-horse-456", sourceKey: "ip:two" });

    expect(recovered.recoveryCode).not.toBe(registered.recoveryCode);
    expect(await identity.authenticate(firstSession.sessionToken)).toBeNull();
    await expect(identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:one" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(identity.recover({ username: "alice", recoveryCode: registered.recoveryCode, newPassword: "another-password-789", sourceKey: "ip:two" })).rejects.toMatchObject({ code: "INVALID_RECOVERY_REQUEST" });
    await expect(identity.login({ username: "alice", password: "new-correct-horse-456", sourceKey: "ip:one" })).resolves.toHaveProperty("sessionToken");
  });

  it("allows a recovery code to win only one concurrent rotation", async () => {
    const { service: identity } = service();
    const registered = await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    const results = await Promise.allSettled([
      identity.recover({ username: "alice", recoveryCode: registered.recoveryCode, newPassword: "first-password-123", sourceKey: "ip:one" }),
      identity.recover({ username: "alice", recoveryCode: registered.recoveryCode, newPassword: "second-password-456", sourceKey: "ip:two" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
