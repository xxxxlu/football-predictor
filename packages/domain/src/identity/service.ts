import { randomUUID } from "node:crypto";

export type AuthAttemptKind = "LOGIN" | "RECOVERY";
export type AccountStatus = "ACTIVE" | "DISABLED";
export type AccessEventKind = "REGISTER" | "LOGIN";
export interface AccessContext {
  ipAddress: string; countryCode: string; region: string; city: string; timezone: string;
  userAgent: string; acceptLanguage: string; deviceClass: string; os: string; browser: string;
}
export interface AudienceDimension { key: string; userCount: number }
export interface AudienceStats {
  totalUsers: number; locatedUsers: number; countries: AudienceDimension[]; regions: AudienceDimension[];
  cities: AudienceDimension[]; deviceClasses: AudienceDimension[]; operatingSystems: AudienceDimension[]; browsers: AudienceDimension[];
}

export interface IdentityAccount {
  id: string;
  usernameCanonical: string;
  passwordHash: string;
  recoveryCodeHash: string;
  acceptedRulesVersion: string;
  acceptedRulesAt: Date;
  status: AccountStatus;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentityRepository {
  createRegisteredAccount(account: IdentityAccount): Promise<void>;
  findAccountByUsername(usernameCanonical: string): Promise<IdentityAccount | null>;
  createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  findActiveSession(tokenHash: string, now: Date, superAdminIdleSince: Date): Promise<IdentityAccount | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
  changePassword(input: { userId: string; currentPasswordHash: string; passwordHash: string; changedAt: Date }): Promise<boolean>;
  createReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; expiresAt: Date }): Promise<void>;
  verifyReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; now: Date }): Promise<boolean>;
  setNormalAccountStatus(input: { actorUserId: string; targetUserId: string; status: AccountStatus; changedAt: Date; auditId: string }): Promise<boolean>;
  listNormalAccounts(): Promise<Array<{ id: string; username: string; status: AccountStatus }>>;
  recoverAccount(input: { userId: string; expectedRecoveryCodeHash: string; passwordHash: string; recoveryCodeHash: string; recoveredAt: Date }): Promise<boolean>;
  countRecentFailures(kind: AuthAttemptKind, accountKey: string, sourceKey: string, since: Date): Promise<number>;
  recordFailure(kind: AuthAttemptKind, accountKey: string, sourceKey: string, occurredAt: Date): Promise<void>;
  recordSecurityEvent(kind: string, accountKey: string, sourceKey: string, occurredAt: Date): Promise<void>;
  clearFailures(kind: AuthAttemptKind, accountKey: string): Promise<void>;
  recordAccessEvent(input: AccessContext & { userId: string; kind: AccessEventKind; occurredAt: Date }): Promise<void>;
  getAudienceStats(): Promise<AudienceStats>;
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
  superAdminIdleTimeoutMs?: number;
  reauthTtlMs?: number;
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export class IdentityService {
  private readonly failureWindowMs: number;
  private readonly maximumFailures: number;
  private readonly superAdminIdleTimeoutMs: number;
  private readonly reauthTtlMs: number;

  constructor(
    private readonly repository: IdentityRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokens: TokenFactory,
    private readonly now: () => Date,
    private readonly options: IdentityServiceOptions,
  ) {
    this.failureWindowMs = options.failureWindowMs ?? 15 * 60_000;
    this.maximumFailures = options.maximumFailures ?? 5;
    this.superAdminIdleTimeoutMs = options.superAdminIdleTimeoutMs ?? 30 * 60_000;
    this.reauthTtlMs = options.reauthTtlMs ?? 5 * 60_000;
  }

  async register(input: { username: string; password: string; isAdultConfirmed: boolean; nonCashRulesVersion: string; accessContext?: AccessContext }) {
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
      isSuperAdmin: false,
      mustChangePassword: false,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    await this.repository.createRegisteredAccount(account);
    if (input.accessContext) await this.repository.recordAccessEvent({ ...input.accessContext, userId: account.id, kind: "REGISTER", occurredAt }).catch(() => undefined);
    return { userId: account.id, username: usernameCanonical, recoveryCode };
  }

  async login(input: { username: string; password: string; sourceKey: string; accessContext?: AccessContext }) {
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
    if (input.accessContext) await this.repository.recordAccessEvent({ ...input.accessContext, userId: account.id, kind: "LOGIN", occurredAt: this.now() }).catch(() => undefined);
    return { sessionToken, expiresAt, userId: account.id, mustChangePassword: account.mustChangePassword };
  }

  async authenticate(sessionToken: string, allowPasswordChange = false) {
    if (!sessionToken) return null;
    const now = this.now();
    const account = await this.repository.findActiveSession(this.tokens.hash(sessionToken), now, new Date(now.getTime() - this.superAdminIdleTimeoutMs));
    return account?.mustChangePassword && !allowPasswordChange ? null : account;
  }

  async changePassword(input: { sessionToken: string; currentPassword: string; newPassword: string }) {
    assertPassword(input.newPassword);
    const account = await this.authenticate(input.sessionToken, true);
    if (!account || !await this.passwordHasher.verify(account.passwordHash, input.currentPassword)) throw new AuthError("INVALID_CREDENTIALS", 401, "Check the current password and try again.");
    const changedAt = this.now();
    const changed = await this.repository.changePassword({ userId: account.id, currentPasswordHash: account.passwordHash, passwordHash: await this.passwordHasher.hash(input.newPassword), changedAt });
    if (!changed) throw new AuthError("PASSWORD_CHANGE_CONFLICT", 409, "Log in again and retry the password change.");
    const sessionToken = this.tokens.sessionToken();
    const expiresAt = new Date(changedAt.getTime() + this.options.sessionTtlMs);
    await this.repository.createSession({ tokenHash: this.tokens.hash(sessionToken), userId: account.id, expiresAt });
    return { sessionToken, expiresAt, mustChangePassword: false as const };
  }

  async reauthenticate(input: { sessionToken: string; password: string }) {
    const account = await this.authenticate(input.sessionToken);
    if (!account || !account.isSuperAdmin || account.mustChangePassword) throw new AuthError("FORBIDDEN", 403, "This operation requires an active super-admin account.");
    if (!await this.passwordHasher.verify(account.passwordHash, input.password)) throw new AuthError("INVALID_CREDENTIALS", 401, "Check the password and try again.");
    const proofToken = this.tokens.sessionToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.reauthTtlMs);
    await this.repository.createReauthProof({ tokenHash: this.tokens.hash(proofToken), userId: account.id, sessionTokenHash: this.tokens.hash(input.sessionToken), expiresAt });
    return { proofToken, expiresAt };
  }

  async listManageableAccounts(actorSessionToken: string) {
    const actor = await this.requireReadySuperAdmin(actorSessionToken);
    return { actorId: actor.id, users: await this.repository.listNormalAccounts() };
  }

  async authorizeSuperAdminAction(input: { sessionToken: string; proofToken: string }) {
    const actor = await this.requireReadySuperAdmin(input.sessionToken);
    const validProof = input.proofToken && await this.repository.verifyReauthProof({ tokenHash: this.tokens.hash(input.proofToken), userId: actor.id, sessionTokenHash: this.tokens.hash(input.sessionToken), now: this.now() });
    if (!validProof) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm the super-admin password again before this operation.");
    return actor;
  }

  async setAccountStatus(input: { actorSessionToken: string; proofToken: string; targetUserId: string; status: AccountStatus }) {
    const actor = await this.authorizeSuperAdminAction({ sessionToken: input.actorSessionToken, proofToken: input.proofToken });
    const auditId = randomUUID();
    const changed = await this.repository.setNormalAccountStatus({ actorUserId: actor.id, targetUserId: input.targetUserId, status: input.status, changedAt: this.now(), auditId });
    if (!changed) throw new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only normal user accounts can be changed here.");
    return { targetUserId: input.targetUserId, status: input.status, auditId };
  }

  async getAudienceStats(sessionToken: string) {
    await this.requireReadySuperAdmin(sessionToken);
    return this.repository.getAudienceStats();
  }

  private async requireReadySuperAdmin(sessionToken: string) {
    const account = await this.authenticate(sessionToken);
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    if (!account.isSuperAdmin) throw new AuthError("FORBIDDEN", 403, "This operation is limited to super administrators.");
    if (account.mustChangePassword) throw new AuthError("PASSWORD_CHANGE_REQUIRED", 403, "Change the initial password before continuing.");
    return account;
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
