import { randomUUID } from "node:crypto";
import {
  type Capability,
  type GrantableOperatorRole,
  type OperatorRole,
  capabilitiesFor,
  hasCapability,
  isGrantableOperatorRole,
  operatorRolesOf,
} from "./capabilities.js";

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
  /**
   * Restricted duties currently granted to this account. Resolved on every
   * session lookup so a revocation takes effect on the next request (FR80).
   */
  operatorRoles: GrantableOperatorRole[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OperatorRosterEntry {
  id: string;
  username: string;
  status: AccountStatus;
  isSuperAdmin: boolean;
  roles: GrantableOperatorRole[];
}

/**
 * Outcome of a persisted role change. The repository owns the invariants that
 * need a transaction (actor is a super-admin, target is an eligible normal
 * account, at most one active grant per role) and reports them as data so the
 * service maps them onto the shared API error contract.
 */
export type OperatorRoleChangeOutcome = "CHANGED" | "UNCHANGED" | "ACTOR_FORBIDDEN" | "TARGET_NOT_ELIGIBLE";

export interface IdentityRepository {
  createRegisteredAccount(account: IdentityAccount): Promise<void>;
  findAccountByUsername(usernameCanonical: string): Promise<IdentityAccount | null>;
  createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  findActiveSession(tokenHash: string, now: Date, superAdminIdleSince: Date): Promise<IdentityAccount | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
  changePassword(input: { userId: string; currentPasswordHash: string; passwordHash: string; changedAt: Date }): Promise<boolean>;
  createReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; expiresAt: Date }): Promise<void>;
  verifyReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; now: Date }): Promise<boolean>;
  setNormalAccountStatus(input: { actorUserId: string; targetUserId: string; status: AccountStatus; reason: string; changedAt: Date; auditId: string }): Promise<boolean>;
  listOperatorRoster(): Promise<OperatorRosterEntry[]>;
  setOperatorRole(input: { actorUserId: string; targetUserId: string; role: GrantableOperatorRole; granted: boolean; changedAt: Date; auditId: string }): Promise<OperatorRoleChangeOutcome>;
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
      operatorRoles: [],
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
    // Any account holding an operator duty may confirm its identity; the proof
    // alone grants nothing — each protected request still checks its capability.
    if (!account || !this.rolesOf(account).length || account.mustChangePassword) throw new AuthError("FORBIDDEN", 403, "This operation requires an active operator account.");
    if (!await this.passwordHasher.verify(account.passwordHash, input.password)) throw new AuthError("INVALID_CREDENTIALS", 401, "Check the password and try again.");
    const proofToken = this.tokens.sessionToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.reauthTtlMs);
    await this.repository.createReauthProof({ tokenHash: this.tokens.hash(proofToken), userId: account.id, sessionTokenHash: this.tokens.hash(input.sessionToken), expiresAt });
    return { proofToken, expiresAt };
  }

  /**
   * Resolves the operator identity behind a session: roles and capabilities are
   * read fresh from storage on every call, so a revoked duty is gone from the
   * very next request without waiting for the session to expire.
   */
  async resolveOperator(sessionToken: string) {
    const account = await this.authenticate(sessionToken);
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    if (account.mustChangePassword) throw new AuthError("PASSWORD_CHANGE_REQUIRED", 403, "Change the initial password before continuing.");
    const roles = this.rolesOf(account);
    return { account, roles, capabilities: [...capabilitiesFor(roles)] };
  }

  /** Server-side gate for a capability-scoped read. */
  async requireCapability(sessionToken: string, capability: Capability) {
    const { account, roles } = await this.resolveOperator(sessionToken);
    if (!hasCapability(roles, capability)) throw new AuthError("FORBIDDEN", 403, "You do not have permission for this operation.");
    return account;
  }

  /** Server-side gate for a sensitive write: capability plus a fresh re-auth proof (NFR18). */
  async authorizeCapabilityAction(input: { sessionToken: string; proofToken: string; capability: Capability }) {
    const actor = await this.requireCapability(input.sessionToken, input.capability);
    const validProof = input.proofToken && await this.repository.verifyReauthProof({ tokenHash: this.tokens.hash(input.proofToken), userId: actor.id, sessionTokenHash: this.tokens.hash(input.sessionToken), now: this.now() });
    if (!validProof) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
    return actor;
  }

  /** Disables or restores a normal account. A justification is mandatory and is
   *  recorded with the change, so the audit trail explains itself later (FR81). */
  async setAccountStatus(input: { actorSessionToken: string; proofToken: string; targetUserId: string; status: AccountStatus; reason: string }) {
    const reason = assertGovernanceReason(input.reason);
    const actor = await this.authorizeCapabilityAction({ sessionToken: input.actorSessionToken, proofToken: input.proofToken, capability: "USER_SECURITY_WRITE" });
    const auditId = randomUUID();
    const changed = await this.repository.setNormalAccountStatus({ actorUserId: actor.id, targetUserId: input.targetUserId, status: input.status, reason, changedAt: this.now(), auditId });
    if (!changed) throw new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only normal user accounts can be changed here.");
    return { targetUserId: input.targetUserId, status: input.status, auditId };
  }

  async listOperatorRoster(sessionToken: string) {
    const actor = await this.requireCapability(sessionToken, "OPERATOR_ROLE_MANAGE");
    return { actorId: actor.id, operators: await this.repository.listOperatorRoster() };
  }

  /**
   * Grants or revokes a restricted duty. Only `OPERATOR_ROLE_MANAGE` (super-admin
   * only) reaches here, `SUPER_ADMIN` itself is not grantable, and nobody can
   * change their own duties — so the seeded pair stays exactly two (FR80).
   */
  async setOperatorRole(input: { actorSessionToken: string; proofToken: string; targetUserId: string; role: string; granted: boolean }) {
    if (!isGrantableOperatorRole(input.role)) throw new AuthError("ROLE_NOT_GRANTABLE", 422, "Only the operations-admin and community-moderator duties can be granted.");
    if (!isUuid(input.targetUserId)) throw new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only normal user accounts can be changed here.");
    const actor = await this.authorizeCapabilityAction({ sessionToken: input.actorSessionToken, proofToken: input.proofToken, capability: "OPERATOR_ROLE_MANAGE" });
    if (actor.id === input.targetUserId) throw new AuthError("SELF_ROLE_CHANGE_FORBIDDEN", 403, "Ask the other super administrator to change your own duties.");

    const auditId = randomUUID();
    const outcome = await this.repository.setOperatorRole({ actorUserId: actor.id, targetUserId: input.targetUserId, role: input.role, granted: input.granted, changedAt: this.now(), auditId });
    if (outcome === "ACTOR_FORBIDDEN") throw new AuthError("FORBIDDEN", 403, "You do not have permission for this operation.");
    if (outcome === "TARGET_NOT_ELIGIBLE") throw new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only active normal accounts can hold an operator duty.");
    return { targetUserId: input.targetUserId, role: input.role, granted: input.granted, changed: outcome === "CHANGED", ...(outcome === "CHANGED" ? { auditId } : {}) };
  }

  async getAudienceStats(sessionToken: string) {
    await this.requireCapability(sessionToken, "AUDIENCE_ANALYTICS_READ");
    return this.repository.getAudienceStats();
  }

  private rolesOf(account: IdentityAccount): OperatorRole[] {
    return operatorRolesOf(account);
  }

  async logout(sessionToken: string) {
    if (sessionToken) await this.repository.revokeSession(this.tokens.hash(sessionToken), this.now());
  }

  async recover(input: { username: string; recoveryCode: string; newPassword: string; sourceKey: string }) {
    const usernameCanonical = safeNormalizeUsername(input.username);
    assertPassword(input.newPassword);
    await this.assertNotRateLimited("RECOVERY", usernameCanonical, input.sourceKey);
    const account = await this.repository.findAccountByUsername(usernameCanonical);
    const valid = account?.status === "ACTIVE" && constantTimeEquals(account.recoveryCodeHash, this.tokens.hash(input.recoveryCode));
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

/**
 * Shared canonical form of the account handle. The PULSE ID members exchange to
 * add friends (Story 12.1) IS the login username, so the two features must never
 * drift onto different rules — both normalize through this single function.
 * Returns null instead of throwing so callers pick their own error contract.
 */
export function canonicalUsername(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : null;
}

function normalizeUsername(username: string) {
  const normalized = canonicalUsername(username);
  if (normalized === null) {
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

/**
 * Compares two token digests without leaking how far the match got.
 *
 * `===` on strings short-circuits at the first differing character. The recovery
 * path is the one place that compares a secret's digest in JS — passwords go
 * through Argon2's own constant-time verify and session tokens are matched in
 * SQL — so it was also the one place where response time carried a per-character
 * signal. An attacker cannot choose a digest directly, but they can grind
 * candidate codes until one's digest shares a leading character, which turns a
 * single 160-bit guess into a character-at-a-time search given enough samples.
 *
 * Accumulating XOR over every position rather than calling `timingSafeEqual`
 * keeps this comparison inside the domain layer's existing dependencies — these
 * are fixed-length lowercase hex digests from one hash function, so there is no
 * encoding step to get wrong. A length mismatch answers false without comparing;
 * a digest's length is not the secret.
 */
function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Every governance write carries an operator-authored justification (FR81/FR90).
 * Bounds match the room moderation reason so one rule covers the whole console.
 */
export const GOVERNANCE_REASON_MIN = 5;
export const GOVERNANCE_REASON_MAX = 500;

/**
 * Counts characters the way the database does. Postgres `char_length` counts code
 * points; `String.length` counts UTF-16 units and sees three emoji as six. Using
 * the JS count let a three-character reason satisfy a minimum of five here and
 * then violate the identical CHECK constraint, turning a refusal into a 500.
 */
export function governanceReasonLength(reason: string): number {
  return [...reason].length;
}

export function assertGovernanceReason(reason: unknown) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  const length = governanceReasonLength(trimmed);
  if (length < GOVERNANCE_REASON_MIN || length > GOVERNANCE_REASON_MAX) {
    throw new AuthError("REASON_REQUIRED", 422, "Give a reason between 5 and 500 characters.");
  }
  return trimmed;
}
