import { randomUUID } from "node:crypto";

export type AuthAttemptKind = "LOGIN" | "RECOVERY";
export type AccountStatus = "ACTIVE" | "DISABLED";

export interface IdentityAccount {
  id: string;
  usernameCanonical: string;
  passwordHash: string;
  recoveryCodeHash: string;
  acceptedRulesVersion: string;
  acceptedRulesAt: Date;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentityRepository {
  createRegisteredAccount(account: IdentityAccount): Promise<void>;
  findAccountByUsername(usernameCanonical: string): Promise<IdentityAccount | null>;
  createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  findActiveSession(tokenHash: string, now: Date): Promise<IdentityAccount | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
  recoverAccount(input: { userId: string; expectedRecoveryCodeHash: string; passwordHash: string; recoveryCodeHash: string; recoveredAt: Date }): Promise<boolean>;
  countRecentFailures(kind: AuthAttemptKind, accountKey: string, sourceKey: string, since: Date): Promise<number>;
  recordFailure(kind: AuthAttemptKind, accountKey: string, sourceKey: string, occurredAt: Date): Promise<void>;
  recordSecurityEvent(kind: string, accountKey: string, sourceKey: string, occurredAt: Date): Promise<void>;
  clearFailures(kind: AuthAttemptKind, accountKey: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface TokenFactory {
  recoveryCode(): string;
  sessionToken(): string;
  hash(value: string): string;
}

export class AuthError extends Error {
  constructor(readonly code: string, readonly status: number, readonly action?: string) {
    super(code);
    this.name = "AuthError";
  }
}

export interface IdentityServiceOptions {
  currentRulesVersion: string;
  sessionTtlMs: number;
  failureWindowMs?: number;
  maximumFailures?: number;
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export class IdentityService {
  private readonly failureWindowMs: number;
  private readonly maximumFailures: number;

  constructor(
    private readonly repository: IdentityRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokens: TokenFactory,
    private readonly now: () => Date,
    private readonly options: IdentityServiceOptions,
  ) {
    this.failureWindowMs = options.failureWindowMs ?? 15 * 60_000;
    this.maximumFailures = options.maximumFailures ?? 5;
  }

  async register(input: { username: string; password: string; isAdultConfirmed: boolean; nonCashRulesVersion: string }) {
    const usernameCanonical = normalizeUsername(input.username);
    assertPassword(input.password);
    if (!input.isAdultConfirmed || input.nonCashRulesVersion !== this.options.currentRulesVersion) {
      throw new AuthError("RULES_CONFIRMATION_REQUIRED", 422, "Confirm the current 18+ and non-cash rules.");
    }

    const occurredAt = this.now();
    const recoveryCode = this.tokens.recoveryCode();
    const account: IdentityAccount = {
      id: randomUUID(),
      usernameCanonical,
      passwordHash: await this.passwordHasher.hash(input.password),
      recoveryCodeHash: this.tokens.hash(recoveryCode),
      acceptedRulesVersion: input.nonCashRulesVersion,
      acceptedRulesAt: occurredAt,
      status: "ACTIVE",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    await this.repository.createRegisteredAccount(account);
    return { userId: account.id, username: usernameCanonical, recoveryCode };
  }

  async login(input: { username: string; password: string; sourceKey: string }) {
    const usernameCanonical = safeNormalizeUsername(input.username);
    await this.assertNotRateLimited("LOGIN", usernameCanonical, input.sourceKey);
    const account = await this.repository.findAccountByUsername(usernameCanonical);
    const valid = account?.status === "ACTIVE" && await this.passwordHasher.verify(account.passwordHash, input.password);
    if (!valid) {
      await this.repository.recordFailure("LOGIN", usernameCanonical, input.sourceKey, this.now());
      throw new AuthError("INVALID_CREDENTIALS", 401, "Check the username and password, then try again.");
    }

    await this.repository.clearFailures("LOGIN", usernameCanonical);
    const sessionToken = this.tokens.sessionToken();
    const expiresAt = new Date(this.now().getTime() + this.options.sessionTtlMs);
    await this.repository.createSession({ tokenHash: this.tokens.hash(sessionToken), userId: account.id, expiresAt });
    return { sessionToken, expiresAt, userId: account.id };
  }

  async authenticate(sessionToken: string) {
    if (!sessionToken) return null;
    return this.repository.findActiveSession(this.tokens.hash(sessionToken), this.now());
  }

  async logout(sessionToken: string) {
    if (sessionToken) await this.repository.revokeSession(this.tokens.hash(sessionToken), this.now());
  }

  async recover(input: { username: string; recoveryCode: string; newPassword: string; sourceKey: string }) {
    const usernameCanonical = safeNormalizeUsername(input.username);
    assertPassword(input.newPassword);
    await this.assertNotRateLimited("RECOVERY", usernameCanonical, input.sourceKey);
    const account = await this.repository.findAccountByUsername(usernameCanonical);
    const valid = account?.status === "ACTIVE" && account.recoveryCodeHash === this.tokens.hash(input.recoveryCode);
    if (!valid) {
      await this.repository.recordFailure("RECOVERY", usernameCanonical, input.sourceKey, this.now());
      throw new AuthError("INVALID_RECOVERY_REQUEST", 400, "Check the recovery details or wait before trying again.");
    }

    const recoveredAt = this.now();
    const recoveryCode = this.tokens.recoveryCode();
    const rotated = await this.repository.recoverAccount({
      userId: account.id,
      expectedRecoveryCodeHash: account.recoveryCodeHash,
      passwordHash: await this.passwordHasher.hash(input.newPassword),
      recoveryCodeHash: this.tokens.hash(recoveryCode),
      recoveredAt,
    });
    if (!rotated) {
      await this.repository.recordFailure("RECOVERY", usernameCanonical, input.sourceKey, this.now());
      throw new AuthError("INVALID_RECOVERY_REQUEST", 400, "Check the recovery details or wait before trying again.");
    }
    await this.repository.clearFailures("RECOVERY", usernameCanonical);
    return { recoveryCode };
  }

  private async assertNotRateLimited(kind: AuthAttemptKind, accountKey: string, sourceKey: string) {
    const since = new Date(this.now().getTime() - this.failureWindowMs);
    if (await this.repository.countRecentFailures(kind, accountKey, sourceKey, since) >= this.maximumFailures) {
      await this.repository.recordSecurityEvent(`${kind}_RATE_LIMITED`, accountKey, sourceKey, this.now());
      throw new AuthError("RATE_LIMITED", 429, "Wait for the 15-minute security window to end.");
    }
  }
}

function normalizeUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AuthError("INVALID_USERNAME", 422, "Use 3-32 lowercase letters, numbers, or underscores.");
  }
  return normalized;
}

function safeNormalizeUsername(username: string) {
  try { return normalizeUsername(username); } catch { return "invalid"; }
}

function assertPassword(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw new AuthError("INVALID_PASSWORD", 422, "Use a password between 12 and 128 characters.");
  }
}
