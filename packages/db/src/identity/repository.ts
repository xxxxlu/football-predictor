import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AuthError, hasCapability, operatorRolesOf, type AccessContext, type AccessEventKind, type AudienceDimension, type AuthAttemptKind, type GrantableOperatorRole, type IdentityAccount, type IdentityRepository, type OperatorRoleChangeOutcome, type OperatorRosterEntry } from "@pulse/domain";
import { accessEvents, adminAccountAuditEvents, authAttempts, identityUsers, operatorRoleGrants, reauthProofs, ruleAcceptances, securityEvents, sessions } from "./schema.js";

const schema = { accessEvents, adminAccountAuditEvents, authAttempts, identityUsers, operatorRoleGrants, reauthProofs, ruleAcceptances, securityEvents, sessions };
export type IdentityDatabase = PostgresJsDatabase<typeof schema>;

export function createIdentityDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, prepare: false });
  return { db: drizzle(client, { schema }), sql: client, close: () => client.end() };
}

export class DrizzleIdentityRepository implements IdentityRepository {
  constructor(private readonly db: IdentityDatabase) {}

  async createRegisteredAccount(account: IdentityAccount): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(identityUsers).values({
          id: account.id,
          usernameCanonical: account.usernameCanonical,
          passwordHash: account.passwordHash,
          recoveryCodeHash: account.recoveryCodeHash,
          status: account.status,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        });
        await tx.insert(ruleAcceptances).values({
          userId: account.id,
          rulesVersion: account.acceptedRulesVersion,
          isAdultConfirmed: true,
          acceptedAt: account.acceptedRulesAt,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AuthError("USERNAME_UNAVAILABLE", 409, "Choose another username.");
      throw error;
    }
  }

  async findAccountByUsername(usernameCanonical: string): Promise<IdentityAccount | null> {
    const [row] = await this.db
      .select({ user: identityUsers, acceptance: ruleAcceptances, operatorRoles: activeOperatorRoles })
      .from(identityUsers)
      .innerJoin(ruleAcceptances, eq(ruleAcceptances.userId, identityUsers.id))
      .where(eq(identityUsers.usernameCanonical, usernameCanonical))
      .orderBy(desc(ruleAcceptances.acceptedAt))
      .limit(1);
    return row ? mapAccount(row.user, row.acceptance.rulesVersion, row.acceptance.acceptedAt, row.operatorRoles) : null;
  }

  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(sessions).values(input);
  }

  // Operator duties are resolved here, on the session lookup every authenticated
  // request already performs, so revoking a duty takes effect on the operator's
  // very next protected request instead of when their session expires (FR80).
  async findActiveSession(tokenHash: string, now: Date, superAdminIdleSince: Date): Promise<IdentityAccount | null> {
    const [row] = await this.db
      .select({ user: identityUsers, acceptance: ruleAcceptances, session: sessions, operatorRoles: activeOperatorRoles })
      .from(sessions)
      .innerJoin(identityUsers, eq(identityUsers.id, sessions.userId))
      .innerJoin(ruleAcceptances, eq(ruleAcceptances.userId, identityUsers.id))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), eq(identityUsers.status, "ACTIVE")))
      .orderBy(desc(ruleAcceptances.acceptedAt))
      .limit(1);
    if (!row) return null;
    if (row.user.isSuperAdmin && row.session.lastSeenAt <= superAdminIdleSince) {
      await this.revokeSession(tokenHash, now);
      return null;
    }
    await this.db.update(sessions).set({ lastSeenAt: now }).where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
    return mapAccount(row.user, row.acceptance.rulesVersion, row.acceptance.acceptedAt, row.operatorRoles);
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.db.update(sessions).set({ revokedAt }).where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  async changePassword(input: { userId: string; currentPasswordHash: string; passwordHash: string; changedAt: Date }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx.update(identityUsers).set({ passwordHash: input.passwordHash, mustChangePassword: false, updatedAt: input.changedAt })
        .where(and(eq(identityUsers.id, input.userId), eq(identityUsers.passwordHash, input.currentPasswordHash), eq(identityUsers.status, "ACTIVE")))
        .returning({ id: identityUsers.id });
      if (!updated.length) return false;
      await tx.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)));
      return true;
    });
  }

  async createReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(reauthProofs).values(input);
  }

  async verifyReauthProof(input: { tokenHash: string; userId: string; sessionTokenHash: string; now: Date }): Promise<boolean> {
    const [proof] = await this.db.select({ tokenHash: reauthProofs.tokenHash }).from(reauthProofs)
      .innerJoin(sessions, eq(sessions.tokenHash, reauthProofs.sessionTokenHash))
      .where(and(eq(reauthProofs.tokenHash, input.tokenHash), eq(reauthProofs.userId, input.userId), eq(reauthProofs.sessionTokenHash, input.sessionTokenHash), gt(reauthProofs.expiresAt, input.now), isNull(sessions.revokedAt), gt(sessions.expiresAt, input.now)))
      .limit(1);
    return Boolean(proof);
  }

  async setNormalAccountStatus(input: { actorUserId: string; targetUserId: string; status: "ACTIVE" | "DISABLED"; reason: string; changedAt: Date; auditId: string }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Defense in depth behind the API gate: re-read the actor's live duties and
      // require the same capability, so this holds for an operations-admin as well
      // as a super-admin and stops holding the moment a grant is revoked.
      const [actor] = await tx
        .select({ isSuperAdmin: identityUsers.isSuperAdmin, roles: activeOperatorRoles })
        .from(identityUsers)
        .where(and(eq(identityUsers.id, input.actorUserId), eq(identityUsers.status, "ACTIVE")))
        .limit(1);
      if (!actor || !hasCapability(operatorRolesOf({ isSuperAdmin: actor.isSuperAdmin, operatorRoles: actor.roles ?? [] }), "USER_SECURITY_WRITE")) return false;
      const updated = await tx.update(identityUsers).set({ status: input.status, updatedAt: input.changedAt })
        .where(and(eq(identityUsers.id, input.targetUserId), eq(identityUsers.isSuperAdmin, false)))
        .returning({ id: identityUsers.id });
      if (!updated.length) return false;
      if (input.status === "DISABLED") await tx.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, input.targetUserId), isNull(sessions.revokedAt)));
      await tx.insert(adminAccountAuditEvents).values({ auditId: input.auditId, actorUserId: input.actorUserId, targetUserId: input.targetUserId, action: input.status === "DISABLED" ? "ACCOUNT_DISABLED" : "ACCOUNT_RESTORED", result: "SUCCESS", metadata: { reason: input.reason }, occurredAt: input.changedAt });
      return true;
    });
  }

  /** Roster for the duty console: identity and duties only, never credentials. */
  async listOperatorRoster(): Promise<OperatorRosterEntry[]> {
    const rows = await this.db
      .select({ id: identityUsers.id, username: identityUsers.usernameCanonical, status: identityUsers.status, isSuperAdmin: identityUsers.isSuperAdmin, roles: activeOperatorRoles })
      .from(identityUsers)
      .orderBy(desc(identityUsers.isSuperAdmin), identityUsers.usernameCanonical);
    return rows.map((row) => ({ ...row, roles: row.roles ?? [] }));
  }

  /**
   * Grants or revokes one restricted duty inside a single transaction: the actor
   * must still be an active super-admin at write time, the target must be an
   * active normal account, and every real change writes an audit row. Repeating a
   * grant or a revoke is a no-op ("UNCHANGED") rather than a duplicate row —
   * the partial unique index would reject it anyway.
   */
  async setOperatorRole(input: { actorUserId: string; targetUserId: string; role: GrantableOperatorRole; granted: boolean; changedAt: Date; auditId: string }): Promise<OperatorRoleChangeOutcome> {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx.select({ allowed: identityUsers.isSuperAdmin }).from(identityUsers)
        .where(and(eq(identityUsers.id, input.actorUserId), eq(identityUsers.status, "ACTIVE"))).limit(1);
      if (!actor?.allowed) return "ACTOR_FORBIDDEN";
      if (input.actorUserId === input.targetUserId) return "ACTOR_FORBIDDEN";

      const [target] = await tx.select({ isSuperAdmin: identityUsers.isSuperAdmin }).from(identityUsers)
        .where(and(eq(identityUsers.id, input.targetUserId), eq(identityUsers.status, "ACTIVE"))).limit(1);
      if (!target || target.isSuperAdmin) return "TARGET_NOT_ELIGIBLE";

      const activeGrant = and(eq(operatorRoleGrants.userId, input.targetUserId), eq(operatorRoleGrants.role, input.role), isNull(operatorRoleGrants.revokedAt));
      if (input.granted) {
        const [existing] = await tx.select({ id: operatorRoleGrants.id }).from(operatorRoleGrants).where(activeGrant).limit(1);
        if (existing) return "UNCHANGED";
        await tx.insert(operatorRoleGrants).values({ id: randomUUID(), userId: input.targetUserId, role: input.role, grantedBy: input.actorUserId, grantedAt: input.changedAt });
      } else {
        const revoked = await tx.update(operatorRoleGrants).set({ revokedAt: input.changedAt, revokedBy: input.actorUserId }).where(activeGrant).returning({ id: operatorRoleGrants.id });
        if (!revoked.length) return "UNCHANGED";
      }

      await tx.insert(adminAccountAuditEvents).values({
        auditId: input.auditId,
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        action: input.granted ? "OPERATOR_ROLE_GRANTED" : "OPERATOR_ROLE_REVOKED",
        result: "SUCCESS",
        metadata: { role: input.role },
        occurredAt: input.changedAt,
      });
      return "CHANGED";
    });
  }

  async recoverAccount(input: { userId: string; expectedRecoveryCodeHash: string; passwordHash: string; recoveryCodeHash: string; recoveredAt: Date }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx.update(identityUsers)
        .set({ passwordHash: input.passwordHash, recoveryCodeHash: input.recoveryCodeHash, updatedAt: input.recoveredAt })
        .where(and(eq(identityUsers.id, input.userId), eq(identityUsers.recoveryCodeHash, input.expectedRecoveryCodeHash)))
        .returning({ id: identityUsers.id });
      if (updated.length === 0) return false;
      await tx.update(sessions).set({ revokedAt: input.recoveredAt }).where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)));
      return true;
    });
  }

  async countRecentFailures(kind: AuthAttemptKind, accountKey: string, sourceKey: string, since: Date): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(authAttempts).where(and(eq(authAttempts.kind, kind), gt(authAttempts.occurredAt, since), or(eq(authAttempts.accountKey, accountKey), eq(authAttempts.sourceKey, sourceKey))));
    return Number(row?.value ?? 0);
  }

  async recordFailure(kind: AuthAttemptKind, accountKey: string, sourceKey: string, occurredAt: Date): Promise<void> {
    await this.db.insert(authAttempts).values({ kind, accountKey, sourceKey, occurredAt });
  }

  async recordSecurityEvent(kind: string, accountKey: string, sourceKey: string, occurredAt: Date): Promise<void> {
    await this.db.insert(securityEvents).values({ kind, accountKey, sourceKey, occurredAt });
  }

  async clearFailures(kind: AuthAttemptKind, accountKey: string): Promise<void> {
    await this.db.delete(authAttempts).where(and(eq(authAttempts.kind, kind), eq(authAttempts.accountKey, accountKey)));
  }

  async recordAccessEvent(input: AccessContext & { userId: string; kind: AccessEventKind; occurredAt: Date }): Promise<void> {
    await this.db.insert(accessEvents).values(input);
  }

  async getAudienceStats() {
    const totals = await this.db.execute<{ total_users: number; located_users: number }>(sql`
      WITH latest AS (SELECT DISTINCT ON (user_id) user_id, country_code FROM identity.access_events ORDER BY user_id, occurred_at DESC)
      SELECT (SELECT COUNT(*)::int FROM identity.users WHERE is_super_admin = false) AS total_users,
             COUNT(*) FILTER (WHERE country_code IS NOT NULL AND country_code <> '')::int AS located_users
      FROM latest INNER JOIN identity.users u ON u.id = latest.user_id AND u.is_super_admin = false
    `);
    const dimension = async (column: "country_code" | "region" | "city" | "device_class" | "os" | "browser"): Promise<AudienceDimension[]> => {
      const field = sql.raw(column);
      const rows = await this.db.execute<{ key: string; user_count: number }>(sql`
        WITH latest AS (SELECT DISTINCT ON (user_id) user_id, ${field} AS value FROM identity.access_events ORDER BY user_id, occurred_at DESC)
        SELECT value AS key, COUNT(*)::int AS user_count FROM latest
        INNER JOIN identity.users u ON u.id = latest.user_id AND u.is_super_admin = false
        WHERE value IS NOT NULL AND value <> '' GROUP BY value ORDER BY user_count DESC, value ASC LIMIT 20
      `);
      return rows.map((row) => ({ key: row.key, userCount: Number(row.user_count) }));
    };
    return {
      totalUsers: Number(totals[0]?.total_users ?? 0), locatedUsers: Number(totals[0]?.located_users ?? 0),
      countries: await dimension("country_code"), regions: await dimension("region"), cities: await dimension("city"),
      deviceClasses: await dimension("device_class"), operatingSystems: await dimension("os"), browsers: await dimension("browser"),
    };
  }
}

/** Live duties of the joined account, as a correlated aggregate so no extra round-trip is needed. */
/**
 * An account's live duties, as a correlated subquery so duties resolve on the
 * same round trip as the session lookup.
 *
 * The table and column names are written out rather than interpolated: inside a
 * subquery drizzle renders an embedded column unqualified, and both tables have
 * an `id`/`user_id`, so `${operatorRoleGrants.userId} = ${identityUsers.id}`
 * rendered as `"user_id" = "id"` — a self-comparison inside the grants table that
 * matched nothing and silently reported every operator as having no duties.
 * Exported so the rendered shape stays under test.
 */
export const activeOperatorRoles = sql<GrantableOperatorRole[] | null>`(
  SELECT array_agg(g.role ORDER BY g.role)
  FROM identity.operator_role_grants g
  WHERE g.user_id = "identity"."users"."id" AND g.revoked_at IS NULL
)`.as("operator_roles");

function mapAccount(user: typeof identityUsers.$inferSelect, acceptedRulesVersion: string, acceptedRulesAt: Date, operatorRoles: GrantableOperatorRole[] | null = null): IdentityAccount {
  return { ...user, acceptedRulesVersion, acceptedRulesAt, operatorRoles: operatorRoles ?? [] };
}

// Detect a Postgres unique-constraint violation (SQLSTATE 23505). The raw postgres.js error carries
// `.code`, but depending on the driver/ORM the error can be WRAPPED (the real error on `.cause` with a
// generic outer message), so a top-level `.code` check silently misses it and the duplicate surfaces as
// a 500 instead of a friendly 409. Walk the cause chain and fall back to the message text so a duplicate
// is caught regardless of how the driver wraps it. Regression-tested in repository.test.ts.
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (typeof current !== "object") break;
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    if (
      typeof candidate.message === "string" &&
      candidate.message.includes("duplicate key value violates unique constraint")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
