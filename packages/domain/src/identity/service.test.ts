import { describe, expect, it } from "vitest";
import { hasCapability, operatorRolesOf, type GrantableOperatorRole } from "./capabilities.js";
import {
  AuthError,
  IdentityService,
  type AuthAttemptKind,
  type AccessContext,
  type IdentityAccount,
  type IdentityRepository,
  type OperatorRoleChangeOutcome,
  type PasswordHasher,
  type TokenFactory,
} from "./service.js";

class MemoryIdentityRepository implements IdentityRepository {
  accounts = new Map<string, IdentityAccount>();
  sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null; lastSeenAt: Date }>();
  failures: Array<{ kind: AuthAttemptKind; accountKey: string; sourceKey: string; occurredAt: Date }> = [];
  proofs = new Map<string, { userId: string; sessionTokenHash: string; expiresAt: Date }>();
  adminEvents: Array<{ actorUserId: string; targetUserId: string; action: string; metadata?: Record<string, unknown> }> = [];
  grants: Array<{ userId: string; role: GrantableOperatorRole; grantedBy: string; grantedAt: Date; revokedAt: Date | null }> = [];
  accessEvents: Array<AccessContext & { userId: string; kind: "REGISTER" | "LOGIN"; occurredAt: Date }> = [];

  private byId(userId: string) { return [...this.accounts.values()].find((candidate) => candidate.id === userId); }
  private activeRoles(userId: string) { return this.grants.filter((grant) => grant.userId === userId && !grant.revokedAt).map((grant) => grant.role).sort(); }
  /** Mirrors the real repository: duties are resolved on every session lookup, not cached on the account. */
  private withRoles(account: IdentityAccount): IdentityAccount { return { ...account, operatorRoles: this.activeRoles(account.id) }; }

  async createRegisteredAccount(account: IdentityAccount): Promise<void> {
    if (this.accounts.has(account.usernameCanonical)) throw new AuthError("USERNAME_UNAVAILABLE", 409);
    this.accounts.set(account.usernameCanonical, account);
  }
  async findAccountByUsername(usernameCanonical: string) {
    const account = this.accounts.get(usernameCanonical);
    return account ? this.withRoles(account) : null;
  }
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
    return this.withRoles(account);
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
  async setNormalAccountStatus(input: { actorUserId: string; targetUserId: string; status: "ACTIVE" | "DISABLED"; reason: string; changedAt: Date; auditId: string }) {
    const actor = [...this.accounts.values()].find((candidate) => candidate.id === input.actorUserId);
    const target = [...this.accounts.values()].find((candidate) => candidate.id === input.targetUserId);
    if (!actor || actor.status !== "ACTIVE") return false;
    // Mirrors the real repository: the duty is what authorizes this, not the
    // super-admin flag. Encoding the flag here made the whole domain suite pass
    // with the capability check reverted.
    if (!hasCapability(operatorRolesOf({ isSuperAdmin: actor.isSuperAdmin, operatorRoles: this.activeRoles(actor.id) }), "USER_SECURITY_WRITE")) return false;
    if (!target || target.isSuperAdmin) return false;
    // An account holding a live duty is not an ordinary account.
    if (this.activeRoles(target.id).length > 0) return false;
    if (actor.id === target.id) return false;
    target.status = input.status;
    if (input.status === "DISABLED") for (const session of this.sessions.values()) if (session.userId === target.id) session.revokedAt = input.changedAt;
    this.adminEvents.push({ actorUserId: actor.id, targetUserId: target.id, action: input.status === "DISABLED" ? "ACCOUNT_DISABLED" : "ACCOUNT_RESTORED", metadata: { reason: input.reason } });
    return true;
  }
  async listOperatorRoster() {
    return [...this.accounts.values()].map((account) => ({ id: account.id, username: account.usernameCanonical, status: account.status, isSuperAdmin: account.isSuperAdmin, roles: this.activeRoles(account.id) }));
  }
  async setOperatorRole(input: { actorUserId: string; targetUserId: string; role: GrantableOperatorRole; granted: boolean; changedAt: Date; auditId: string }): Promise<OperatorRoleChangeOutcome> {
    const actor = this.byId(input.actorUserId);
    if (!actor?.isSuperAdmin || actor.status !== "ACTIVE") return "ACTOR_FORBIDDEN";
    if (input.actorUserId === input.targetUserId) return "ACTOR_FORBIDDEN";
    const target = this.byId(input.targetUserId);
    if (!target || target.isSuperAdmin || target.status !== "ACTIVE") return "TARGET_NOT_ELIGIBLE";
    const active = this.grants.find((grant) => grant.userId === input.targetUserId && grant.role === input.role && !grant.revokedAt);
    if (input.granted) {
      if (active) return "UNCHANGED";
      this.grants.push({ userId: input.targetUserId, role: input.role, grantedBy: input.actorUserId, grantedAt: input.changedAt, revokedAt: null });
    } else {
      if (!active) return "UNCHANGED";
      active.revokedAt = input.changedAt;
    }
    this.adminEvents.push({ actorUserId: input.actorUserId, targetUserId: input.targetUserId, action: input.granted ? "OPERATOR_ROLE_GRANTED" : "OPERATOR_ROLE_REVOKED", metadata: { role: input.role } });
    return "CHANGED";
  }
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

    await expect(identity.setAccountStatus({ actorSessionToken: adminLogin.sessionToken, proofToken: "missing", targetUserId: repository.accounts.get("alice")!.id, status: "DISABLED", reason: "运营处置：账户安全复核" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
    const proof = await identity.reauthenticate({ sessionToken: adminLogin.sessionToken, password: "rotated-password-456" });
    await expect(identity.authorizeCapabilityAction({ sessionToken: adminLogin.sessionToken, proofToken: proof.proofToken, capability: "USER_SECURITY_WRITE" })).resolves.toMatchObject({ id: repository.accounts.get("ops_admin")!.id });
    await expect(identity.setAccountStatus({ actorSessionToken: adminLogin.sessionToken, proofToken: proof.proofToken, targetUserId: repository.accounts.get("alice")!.id, status: "DISABLED", reason: "运营处置：账户安全复核" })).resolves.toHaveProperty("auditId");
    expect(await identity.authenticate(userLogin.sessionToken)).toBeNull();

    clock = new Date("2026-07-13T10:05:01.000Z");
    await expect(identity.authorizeCapabilityAction({ sessionToken: adminLogin.sessionToken, proofToken: proof.proofToken, capability: "USER_SECURITY_WRITE" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    await expect(identity.setAccountStatus({ actorSessionToken: adminLogin.sessionToken, proofToken: proof.proofToken, targetUserId: repository.accounts.get("alice")!.id, status: "ACTIVE", reason: "运营处置：账户安全复核" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("never permits a super-admin account to be disabled through the product API", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "ops_admin", password: "rotated-password-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "ops_backup", password: "backup-password-789", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    repository.accounts.get("ops_backup")!.isSuperAdmin = true;
    const login = await identity.login({ username: "ops_admin", password: "rotated-password-456", sourceKey: "ip:ops" });
    const proof = await identity.reauthenticate({ sessionToken: login.sessionToken, password: "rotated-password-456" });
    await expect(identity.setAccountStatus({ actorSessionToken: login.sessionToken, proofToken: proof.proofToken, targetUserId: repository.accounts.get("ops_backup")!.id, status: "DISABLED", reason: "运营处置：账户安全复核" })).rejects.toMatchObject({ code: "TARGET_NOT_MANAGEABLE" });
  });
});

describe("IdentityService role enforcement", () => {
  it("denies a normal authenticated user every super-admin capability", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "bob", password: "correct-horse-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    const login = await identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:user" });
    const bobId = repository.accounts.get("bob")!.id;

    await expect(identity.requireCapability(login.sessionToken, "USER_SECURITY_READ")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.authorizeCapabilityAction({ sessionToken: login.sessionToken, proofToken: "anything", capability: "USER_SECURITY_WRITE" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.reauthenticate({ sessionToken: login.sessionToken, password: "correct-horse-123" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.setAccountStatus({ actorSessionToken: login.sessionToken, proofToken: "anything", targetUserId: bobId, status: "DISABLED", reason: "运营处置：账户安全复核" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(repository.accounts.get("bob")!.status).toBe("ACTIVE");
  });

  it("rejects anonymous or unknown sessions before any super-admin read", async () => {
    const { service: identity } = service();
    await expect(identity.requireCapability("", "USER_SECURITY_READ")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(identity.requireCapability("unknown-token", "USER_SECURITY_READ")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("never provisions a super-admin through public registration", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "attacker", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    expect(repository.accounts.get("attacker")!.isSuperAdmin).toBe(false);
    const login = await identity.login({ username: "attacker", password: "correct-horse-123", sourceKey: "ip:user" });
    expect((await identity.authenticate(login.sessionToken))?.isSuperAdmin).toBe(false);
  });

  it("resolves a ready super-admin with every capability, a normal account with none", async () => {
    const { service: identity, repository } = service();
    await identity.register({ username: "ops_admin", password: "rotated-password-456", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    await identity.register({ username: "alice", password: "correct-horse-123", isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    const admin = await identity.login({ username: "ops_admin", password: "rotated-password-456", sourceKey: "ip:ops" });
    const user = await identity.login({ username: "alice", password: "correct-horse-123", sourceKey: "ip:user" });

    await expect(identity.resolveOperator(admin.sessionToken)).resolves.toMatchObject({ roles: ["SUPER_ADMIN"] });
    await expect(identity.requireCapability(admin.sessionToken, "USER_SECURITY_READ")).resolves.toMatchObject({ usernameCanonical: "ops_admin" });
    await expect(identity.resolveOperator(user.sessionToken)).resolves.toMatchObject({ roles: [], capabilities: [] });
  });
});

describe("IdentityService operator duties", () => {
  /** Two seeded super-admins plus a normal account, all logged in. */
  async function operatorFixture() {
    let clock = new Date("2026-07-13T10:00:00.000Z");
    const repository = new MemoryIdentityRepository();
    const identity = new IdentityService(repository, passwordHasher, tokens, () => clock, { currentRulesVersion: "rules-2026-07", sessionTtlMs: 86_400_000, reauthTtlMs: 5 * 60_000 });
    for (const username of ["ops_admin", "ops_backup", "alice", "bob"]) {
      await identity.register({ username, password: `${username}-password-123`, isAdultConfirmed: true, nonCashRulesVersion: "rules-2026-07" });
    }
    repository.accounts.get("ops_admin")!.isSuperAdmin = true;
    repository.accounts.get("ops_backup")!.isSuperAdmin = true;
    const login = async (username: string) => identity.login({ username, password: `${username}-password-123`, sourceKey: `ip:${username}` });
    const proofFor = async (username: string, sessionToken: string) => (await identity.reauthenticate({ sessionToken, password: `${username}-password-123` })).proofToken;
    const id = (username: string) => repository.accounts.get(username)!.id;
    return { repository, identity, login, proofFor, id, advance: (iso: string) => { clock = new Date(iso); } };
  }

  it("lets only a super-admin grant or revoke a restricted duty", async () => {
    const { identity, login, proofFor, id, repository } = await operatorFixture();
    const admin = await login("ops_admin");
    const adminProof = await proofFor("ops_admin", admin.sessionToken);

    // A normal user is refused before the target is ever looked at.
    const alice = await login("alice");
    await expect(identity.setOperatorRole({ actorSessionToken: alice.sessionToken, proofToken: "anything", targetUserId: id("bob"), role: "OPERATIONS_ADMIN", granted: true })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(repository.grants).toHaveLength(0);

    // An operations-admin holds real duties but not the duty to hand them out.
    await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: adminProof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true });
    const operator = await login("alice");
    const operatorProof = await proofFor("alice", operator.sessionToken);
    await expect(identity.setOperatorRole({ actorSessionToken: operator.sessionToken, proofToken: operatorProof, targetUserId: id("bob"), role: "COMMUNITY_MODERATOR", granted: true })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.setOperatorRole({ actorSessionToken: operator.sessionToken, proofToken: operatorProof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: false })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.listOperatorRoster(operator.sessionToken)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(repository.grants.filter((grant) => !grant.revokedAt).map((grant) => grant.role)).toEqual(["OPERATIONS_ADMIN"]);
  });

  it("refuses a self-grant and a self-revoke even from a super-admin", async () => {
    const { identity, login, proofFor, id, repository } = await operatorFixture();
    const admin = await login("ops_admin");
    const proof = await proofFor("ops_admin", admin.sessionToken);
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("ops_admin"), role: "OPERATIONS_ADMIN", granted: true })).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE_FORBIDDEN", status: 403 });
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("ops_admin"), role: "COMMUNITY_MODERATOR", granted: false })).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE_FORBIDDEN", status: 403 });
    expect(repository.grants).toHaveLength(0);
    expect(repository.adminEvents).toHaveLength(0);
  });

  it("keeps exactly the two seeded super-admins: SUPER_ADMIN is not a grantable duty", async () => {
    const { identity, login, proofFor, id, repository } = await operatorFixture();
    const admin = await login("ops_admin");
    const proof = await proofFor("ops_admin", admin.sessionToken);
    const superAdmins = () => [...repository.accounts.values()].filter((account) => account.isSuperAdmin).length;
    expect(superAdmins()).toBe(2);

    for (const role of ["SUPER_ADMIN", "super_admin", "OWNER", ""]) {
      await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), role, granted: true })).rejects.toMatchObject({ code: "ROLE_NOT_GRANTABLE", status: 422 });
    }
    // A granted duty never promotes the account, and the pair is untouched.
    await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true });
    expect(repository.accounts.get("alice")!.isSuperAdmin).toBe(false);
    expect(superAdmins()).toBe(2);
    // The other super-admin is not an eligible grant target either.
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("ops_backup"), role: "OPERATIONS_ADMIN", granted: true })).rejects.toMatchObject({ code: "TARGET_NOT_MANAGEABLE", status: 422 });
  });

  it("requires a fresh re-auth proof for both granting and revoking", async () => {
    const { identity, login, proofFor, id, repository, advance } = await operatorFixture();
    const admin = await login("ops_admin");

    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: "", targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true })).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: "forged-proof", targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true })).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
    expect(repository.grants).toHaveLength(0);

    const proof = await proofFor("ops_admin", admin.sessionToken);
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true })).resolves.toMatchObject({ granted: true, changed: true });

    // The proof expires after five minutes; revoking then needs a new one.
    advance("2026-07-13T10:05:01.000Z");
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: false })).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
    expect(repository.grants.filter((grant) => !grant.revokedAt)).toHaveLength(1);
    const renewed = await proofFor("ops_admin", admin.sessionToken);
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: renewed, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: false })).resolves.toMatchObject({ granted: false, changed: true });
  });

  it("takes the duty away on the operator's very next protected request after a revoke", async () => {
    const { identity, login, proofFor, id } = await operatorFixture();
    const admin = await login("ops_admin");
    const grantProof = await proofFor("ops_admin", admin.sessionToken);
    await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: grantProof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true });

    // Same session token throughout: the duty is re-read per request, not baked into the session.
    const operator = await login("alice");
    await expect(identity.requireCapability(operator.sessionToken, "USER_SECURITY_READ")).resolves.toMatchObject({ usernameCanonical: "alice" });
    await expect(identity.resolveOperator(operator.sessionToken)).resolves.toMatchObject({ roles: ["OPERATIONS_ADMIN"] });

    const revokeProof = await proofFor("ops_admin", admin.sessionToken);
    await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: revokeProof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: false });

    await expect(identity.requireCapability(operator.sessionToken, "USER_SECURITY_READ")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.requireCapability(operator.sessionToken, "ROOM_GOVERNANCE_WRITE")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.resolveOperator(operator.sessionToken)).resolves.toMatchObject({ roles: [], capabilities: [] });
    // Their own account still works — losing a duty is not a logout.
    expect((await identity.authenticate(operator.sessionToken))?.usernameCanonical).toBe("alice");
  });

  it("audits every role change with actor, target and duty, and never with a credential", async () => {
    const { identity, login, proofFor, id, repository } = await operatorFixture();
    const admin = await login("ops_admin");
    const grantProof = await proofFor("ops_admin", admin.sessionToken);
    const granted = await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: grantProof, targetUserId: id("alice"), role: "COMMUNITY_MODERATOR", granted: true });
    const revokeProof = await proofFor("ops_admin", admin.sessionToken);
    const revoked = await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: revokeProof, targetUserId: id("alice"), role: "COMMUNITY_MODERATOR", granted: false });

    expect(granted).toMatchObject({ auditId: expect.any(String) });
    expect(revoked).toMatchObject({ auditId: expect.any(String) });
    expect(repository.adminEvents).toEqual([
      { actorUserId: id("ops_admin"), targetUserId: id("alice"), action: "OPERATOR_ROLE_GRANTED", metadata: { role: "COMMUNITY_MODERATOR" } },
      { actorUserId: id("ops_admin"), targetUserId: id("alice"), action: "OPERATOR_ROLE_REVOKED", metadata: { role: "COMMUNITY_MODERATOR" } },
    ]);
    const trail = JSON.stringify([repository.adminEvents, repository.grants, granted, revoked]);
    for (const secret of [admin.sessionToken, grantProof, revokeProof, "ops_admin-password-123", repository.accounts.get("ops_admin")!.passwordHash, repository.accounts.get("alice")!.recoveryCodeHash]) {
      expect(trail).not.toContain(secret);
    }

    // A repeated grant is a no-op rather than a second audit row.
    const repeatProof = await proofFor("ops_admin", admin.sessionToken);
    await expect(identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: repeatProof, targetUserId: id("alice"), role: "COMMUNITY_MODERATOR", granted: false })).resolves.toMatchObject({ changed: false });
    expect(repository.adminEvents).toHaveLength(2);
  });

  it("denies a restricted operator every capability outside its own duty", async () => {
    const { identity, login, proofFor, id } = await operatorFixture();
    const admin = await login("ops_admin");
    const proof = await proofFor("ops_admin", admin.sessionToken);
    await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), role: "OPERATIONS_ADMIN", granted: true });
    const secondProof = await proofFor("ops_admin", admin.sessionToken);
    await identity.setOperatorRole({ actorSessionToken: admin.sessionToken, proofToken: secondProof, targetUserId: id("bob"), role: "COMMUNITY_MODERATOR", granted: true });

    const operations = await login("alice");
    const community = await login("bob");

    // Operations: user security and room governance yes; audit, audience,
    // community moderation, result entry and duty administration no.
    await expect(identity.requireCapability(operations.sessionToken, "USER_SECURITY_READ")).resolves.toMatchObject({ usernameCanonical: "alice" });
    await expect(identity.requireCapability(operations.sessionToken, "ROOM_GOVERNANCE_WRITE")).resolves.toMatchObject({ usernameCanonical: "alice" });
    for (const capability of ["AUDIT_READ", "AUDIENCE_ANALYTICS_READ", "COMMUNITY_GOVERNANCE_WRITE", "COMPETITION_RESULT_ENTRY", "OPERATOR_ROLE_MANAGE"] as const) {
      await expect(identity.requireCapability(operations.sessionToken, capability)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
    await expect(identity.getAudienceStats(operations.sessionToken)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // Community: report and chat governance yes; the user roster and room writes no.
    await expect(identity.requireCapability(community.sessionToken, "COMMUNITY_GOVERNANCE_WRITE")).resolves.toMatchObject({ usernameCanonical: "bob" });
    for (const capability of ["USER_SECURITY_READ", "USER_SECURITY_WRITE", "ROOM_GOVERNANCE_WRITE", "OPERATIONS_HEALTH_READ", "AUDIT_READ"] as const) {
      await expect(identity.requireCapability(community.sessionToken, capability)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
    await expect(identity.requireCapability(community.sessionToken, "USER_SECURITY_READ")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(identity.setAccountStatus({ actorSessionToken: community.sessionToken, proofToken: await proofFor("bob", community.sessionToken), targetUserId: id("alice"), status: "DISABLED", reason: "运营处置：账户安全复核" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("refuses a status change with no usable justification and records the reason when given", async () => {
    const { identity, login, proofFor, id, repository } = await operatorFixture();
    const admin = await login("ops_admin");
    const proof = await proofFor("ops_admin", admin.sessionToken);

    for (const reason of ["", "   ", "abc", "x".repeat(501)]) {
      await expect(identity.setAccountStatus({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), status: "DISABLED", reason }))
        .rejects.toMatchObject({ code: "REASON_REQUIRED", status: 422 });
    }
    // Refused before anything is touched — no state change, no audit row.
    expect(repository.accounts.get("alice")!.status).toBe("ACTIVE");
    expect(repository.adminEvents).toHaveLength(0);

    await expect(identity.setAccountStatus({ actorSessionToken: admin.sessionToken, proofToken: proof, targetUserId: id("alice"), status: "DISABLED", reason: "  多次违规举报，暂停账户  " }))
      .resolves.toMatchObject({ status: "DISABLED" });
    expect(repository.adminEvents).toEqual([
      { actorUserId: id("ops_admin"), targetUserId: id("alice"), action: "ACCOUNT_DISABLED", metadata: { reason: "多次违规举报，暂停账户" } },
    ]);
  });

  it("refuses to re-authenticate an account that holds no operator duty", async () => {
    const { identity, login } = await operatorFixture();
    const alice = await login("alice");
    await expect(identity.reauthenticate({ sessionToken: alice.sessionToken, password: "alice-password-123" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
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
