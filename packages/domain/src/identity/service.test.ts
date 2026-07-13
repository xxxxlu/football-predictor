import { describe, expect, it } from "vitest";
import {
  AuthError,
  IdentityService,
  type AuthAttemptKind,
  type IdentityAccount,
  type IdentityRepository,
  type PasswordHasher,
  type TokenFactory,
} from "./service.js";

class MemoryIdentityRepository implements IdentityRepository {
  accounts = new Map<string, IdentityAccount>();
  sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null }>();
  failures: Array<{ kind: AuthAttemptKind; accountKey: string; sourceKey: string; occurredAt: Date }> = [];

  async createRegisteredAccount(account: IdentityAccount): Promise<void> {
    if (this.accounts.has(account.usernameCanonical)) throw new AuthError("USERNAME_UNAVAILABLE", 409);
    this.accounts.set(account.usernameCanonical, account);
  }
  async findAccountByUsername(usernameCanonical: string) { return this.accounts.get(usernameCanonical) ?? null; }
  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date }) {
    this.sessions.set(input.tokenHash, { userId: input.userId, expiresAt: input.expiresAt, revokedAt: null });
  }
  async revokeSession(tokenHash: string, revokedAt: Date) {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = revokedAt;
  }
  async findActiveSession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const account = [...this.accounts.values()].find((candidate) => candidate.id === session.userId);
    return account?.status === "ACTIVE" ? account : null;
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
