import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AuthError, type AuthAttemptKind, type IdentityAccount, type IdentityRepository } from "@football-predictor/domain";
import { adminAccountAuditEvents, authAttempts, identityUsers, reauthProofs, ruleAcceptances, securityEvents, sessions } from "./schema.js";

const schema = { adminAccountAuditEvents, authAttempts, identityUsers, reauthProofs, ruleAcceptances, securityEvents, sessions };
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
      .select({ user: identityUsers, acceptance: ruleAcceptances })
      .from(identityUsers)
      .innerJoin(ruleAcceptances, eq(ruleAcceptances.userId, identityUsers.id))
      .where(eq(identityUsers.usernameCanonical, usernameCanonical))
      .orderBy(desc(ruleAcceptances.acceptedAt))
      .limit(1);
    return row ? mapAccount(row.user, row.acceptance.rulesVersion, row.acceptance.acceptedAt) : null;
  }

  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(sessions).values(input);
  }

  async findActiveSession(tokenHash: string, now: Date, superAdminIdleSince: Date): Promise<IdentityAccount | null> {
    const [row] = await this.db
      .select({ user: identityUsers, acceptance: ruleAcceptances, session: sessions })
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
    return mapAccount(row.user, row.acceptance.rulesVersion, row.acceptance.acceptedAt);
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

  async setNormalAccountStatus(input: { actorUserId: string; targetUserId: string; status: "ACTIVE" | "DISABLED"; changedAt: Date; auditId: string }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx.select({ allowed: identityUsers.isSuperAdmin }).from(identityUsers).where(and(eq(identityUsers.id, input.actorUserId), eq(identityUsers.status, "ACTIVE"))).limit(1);
      if (!actor?.allowed) return false;
      const updated = await tx.update(identityUsers).set({ status: input.status, updatedAt: input.changedAt })
        .where(and(eq(identityUsers.id, input.targetUserId), eq(identityUsers.isSuperAdmin, false)))
        .returning({ id: identityUsers.id });
      if (!updated.length) return false;
      if (input.status === "DISABLED") await tx.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, input.targetUserId), isNull(sessions.revokedAt)));
      await tx.insert(adminAccountAuditEvents).values({ auditId: input.auditId, actorUserId: input.actorUserId, targetUserId: input.targetUserId, action: input.status === "DISABLED" ? "ACCOUNT_DISABLED" : "ACCOUNT_RESTORED", result: "SUCCESS", occurredAt: input.changedAt });
      return true;
    });
  }

  async listNormalAccounts() {
    const rows = await this.db.select({ id: identityUsers.id, username: identityUsers.usernameCanonical, status: identityUsers.status }).from(identityUsers).where(eq(identityUsers.isSuperAdmin, false)).orderBy(identityUsers.usernameCanonical);
    return rows;
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
}

function mapAccount(user: typeof identityUsers.$inferSelect, acceptedRulesVersion: string, acceptedRulesAt: Date): IdentityAccount {
  return { ...user, acceptedRulesVersion, acceptedRulesAt };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
