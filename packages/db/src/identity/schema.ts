import { index, pgEnum, pgSchema, primaryKey, text, timestamp, unique, uuid, boolean } from "drizzle-orm/pg-core";

export const identitySchema = pgSchema("identity");
export const accountStatus = pgEnum("identity_account_status", ["ACTIVE", "DISABLED"]);
export const authAttemptKind = pgEnum("identity_auth_attempt_kind", ["LOGIN", "RECOVERY"]);

export const identityUsers = identitySchema.table("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  usernameCanonical: text("username_canonical").notNull(),
  passwordHash: text("password_hash").notNull(),
  recoveryCodeHash: text("recovery_code_hash").notNull(),
  nickname: text("nickname"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  status: accountStatus("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("identity_users_username_unique").on(table.usernameCanonical)]);

export const ruleAcceptances = identitySchema.table("rule_acceptances", {
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  rulesVersion: text("rules_version").notNull(),
  isAdultConfirmed: boolean("is_adult_confirmed").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.rulesVersion] })]);

export const sessions = identitySchema.table("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("identity_sessions_user_idx").on(table.userId)]);

export const reauthProofs = identitySchema.table("reauth_proofs", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  sessionTokenHash: text("session_token_hash").notNull().references(() => sessions.tokenHash, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("identity_reauth_proofs_user_expiry_idx").on(table.userId, table.expiresAt)]);

export const adminAccountAuditEvents = identitySchema.table("admin_account_audit_events", {
  auditId: uuid("audit_id").primaryKey(),
  actorUserId: uuid("actor_user_id").notNull().references(() => identityUsers.id),
  targetUserId: uuid("target_user_id").notNull().references(() => identityUsers.id),
  action: text("action").notNull(),
  result: text("result").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

export const authAttempts = identitySchema.table("auth_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: authAttemptKind("kind").notNull(),
  accountKey: text("account_key").notNull(),
  sourceKey: text("source_key").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("identity_auth_attempt_account_idx").on(table.kind, table.accountKey, table.occurredAt),
  index("identity_auth_attempt_source_idx").on(table.kind, table.sourceKey, table.occurredAt),
]);

export const securityEvents = identitySchema.table("security_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  accountKey: text("account_key").notNull(),
  sourceKey: text("source_key").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});
