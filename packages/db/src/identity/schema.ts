import { index, jsonb, pgEnum, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const identitySchema = pgSchema("identity");
export const accountStatus = pgEnum("identity_account_status", ["ACTIVE", "DISABLED"]);
export const authAttemptKind = pgEnum("identity_auth_attempt_kind", ["LOGIN", "RECOVERY"]);
export const accessEventKind = pgEnum("identity_access_event_kind", ["REGISTER", "LOGIN"]);
export const operatorRole = identitySchema.enum("operator_role", ["OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"]);

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

/**
 * Restricted operator duties (FR80). A revoked grant keeps its row so the audit
 * trail stays complete; the partial unique index below is what guarantees a
 * single live grant per account and duty.
 */
export const operatorRoleGrants = identitySchema.table("operator_role_grants", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  role: operatorRole("role").notNull(),
  grantedBy: uuid("granted_by").notNull().references(() => identityUsers.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  revokedBy: uuid("revoked_by").references(() => identityUsers.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("identity_operator_role_grants_active_idx").on(table.userId, table.role).where(sql`${table.revokedAt} is null`),
  index("identity_operator_role_grants_user_idx").on(table.userId).where(sql`${table.revokedAt} is null`),
]);

export const adminAccountAuditEvents = identitySchema.table("admin_account_audit_events", {
  auditId: uuid("audit_id").primaryKey(),
  actorUserId: uuid("actor_user_id").notNull().references(() => identityUsers.id),
  targetUserId: uuid("target_user_id").notNull().references(() => identityUsers.id),
  action: text("action").notNull(),
  result: text("result").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [index("identity_admin_account_audit_events_occurred_idx").on(table.occurredAt)]);

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

export const accessEvents = identitySchema.table("access_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  kind: accessEventKind("kind").notNull(),
  ipAddress: text("ip_address").notNull(),
  countryCode: text("country_code"),
  region: text("region"),
  city: text("city"),
  timezone: text("timezone"),
  userAgent: text("user_agent"),
  acceptLanguage: text("accept_language"),
  deviceClass: text("device_class"),
  os: text("os"),
  browser: text("browser"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("identity_access_events_user_time_idx").on(table.userId, table.occurredAt),
  index("identity_access_events_country_time_idx").on(table.countryCode, table.occurredAt),
]);
