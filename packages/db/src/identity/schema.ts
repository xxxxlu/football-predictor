import { index, integer, jsonb, pgEnum, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
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
  showOnlineToFriends: boolean("show_online_to_friends").notNull().default(false),
  showLobbyToFriends: boolean("show_lobby_to_friends").notNull().default(false),
  showInLobbyDirectory: boolean("show_in_lobby_directory").notNull().default(false),
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

/**
 * One row per user pair in canonical order (user_lo_id < user_hi_id) so the
 * pair unique constraint arbitrates duplicate/concurrent relationships (FR84).
 */
export const friendships = identitySchema.table("friendships", {
  id: uuid("id").defaultRandom().primaryKey(),
  userLoId: uuid("user_lo_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  userHiId: uuid("user_hi_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("PENDING"),
  requestedBy: uuid("requested_by").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, (table) => [
  unique("friendships_pair_unique").on(table.userLoId, table.userHiId),
  index("friendships_user_hi_idx").on(table.userHiId),
]);

/** Directional blocks; a block in either direction outranks friendship actions. */
export const userBlocks = identitySchema.table("user_blocks", {
  blockerUserId: uuid("blocker_user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  blockedUserId: uuid("blocked_user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.blockerUserId, table.blockedUserId] }),
  index("user_blocks_blocked_idx").on(table.blockedUserId),
]);

/**
 * Heartbeat signals filtered by TTL at read time (FR85). lobby_beat_at is
 * reserved for Story 12.4; sessions.last_seen_at must never back presence.
 */
export const presenceSignals = identitySchema.table("presence_signals", {
  userId: uuid("user_id").primaryKey().references(() => identityUsers.id, { onDelete: "cascade" }),
  onlineBeatAt: timestamp("online_beat_at", { withTimezone: true }),
  lobbyBeatAt: timestamp("lobby_beat_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Persisted counting window for friend-request rate limiting (10/h, 50/d). */
export const friendRequestEvents = identitySchema.table("friend_request_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  requesterUserId: uuid("requester_user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  // 0027: the same ledger throttles blocks too; existing rows backfill as FRIEND_REQUEST.
  kind: text("kind").notNull().default("FRIEND_REQUEST"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("friend_request_events_requester_kind_time_idx").on(table.requesterUserId, table.kind, table.occurredAt)]);

/**
 * One avatar per account (Story 12.6). The row holds the CloudBase handle and
 * the metadata a projection needs — never image bytes, and never a temporary CDN
 * URL, which expires and would rot in the database.
 *
 * `publicId` is the random handle the same-origin media URL is built from; the
 * object key stays server-side. `version` is monotonic per account and is
 * enforced by the 0030 trigger, not by application code alone.
 */
export const userAvatars = identitySchema.table("user_avatars", {
  userId: uuid("user_id").primaryKey().references(() => identityUsers.id, { onDelete: "cascade" }),
  publicId: uuid("public_id").notNull().defaultRandom(),
  fileId: text("file_id").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  version: integer("version").notNull().default(1),
  moderationStatus: text("moderation_status").notNull().default("APPROVED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("user_avatars_public_id_unique").on(table.publicId),
  unique("user_avatars_object_key_unique").on(table.objectKey),
  index("user_avatars_moderation_idx").on(table.moderationStatus),
]);

/** Persisted counting window for the avatar change quota (5/h, 20/d). */
export const avatarChangeEvents = identitySchema.table("avatar_change_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("avatar_change_events_user_time_idx").on(table.userId, table.occurredAt)]);

/**
 * Object-storage deletions still owed. No user_id and no FK on purpose: the row
 * has to outlive the account it came from, otherwise deleting an account would
 * drop the only pointer to an image that is still sitting in the bucket.
 */
export const avatarObjectDeletions = identitySchema.table("avatar_object_deletions", {
  id: uuid("id").defaultRandom().primaryKey(),
  objectKey: text("object_key").notNull(),
  fileId: text("file_id"),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("avatar_object_deletions_object_key_unique").on(table.objectKey),
  index("avatar_object_deletions_pending_idx").on(table.enqueuedAt).where(sql`${table.deletedAt} is null`),
]);

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
