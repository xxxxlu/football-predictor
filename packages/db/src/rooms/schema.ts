import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, numeric, pgEnum, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { identityUsers } from "../identity/schema.js";

export const roomSchema = pgSchema("room");
export const ledgerSchema = pgSchema("ledger");
export const roomStatus = pgEnum("room_status", ["ACTIVE", "RESTRICTED", "CLOSED"]);
export const roomRole = pgEnum("room_role", ["OWNER", "MEMBER"]);
export const roomVisibility = pgEnum("room_visibility", ["PUBLIC", "PRIVATE"]);
export const roomTier = pgEnum("room_tier", ["STANDARD", "ADVANCED"]);
export const roomSport = pgEnum("room_sport", ["FOOTBALL", "FORMULA_1"]);

export const rooms = roomSchema.table("rooms", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  status: roomStatus("status").notNull().default("ACTIVE"),
  visibility: roomVisibility("visibility").notNull().default("PRIVATE"),
  tier: roomTier("tier").notNull().default("STANDARD"),
  sport: roomSport("sport").notNull().default("FOOTBALL"),
  preMatchStakeVisible: boolean("pre_match_stake_visible").notNull().default(false),
  postMatchTicketVisible: boolean("post_match_ticket_visible").notNull().default(true),
  inviteTokenHash: text("invite_token_hash"),
  createdBy: uuid("created_by").notNull().references(() => identityUsers.id),
  // One pinned chat message per room (Story 12.3); FK added in 0025.
  pinnedMessageId: uuid("pinned_message_id"),
  pinnedBy: uuid("pinned_by"),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("room_invite_token_hash_unique").on(table.inviteTokenHash),
  // 0031: carries `id` so the lobby's (created_at, id) keyset page is a clean
  // index scan; supersedes the three-column room_public_discovery_idx.
  index("room_public_discovery_keyset_idx").on(table.visibility, table.status, table.createdAt, table.id),
  // 0031: serves both creation guards — the per-owner active cap and the
  // per-owner rate window — from room.rooms itself, no event ledger needed.
  index("room_owner_creation_idx").on(table.createdBy, table.createdAt),
]);

/**
 * Immutable public chat messages (Story 12.3, FR88): no edit or delete columns
 * by design — visibility changes go through room.message_moderation.
 */
export const roomMessages = roomSchema.table("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("room_messages_keyset_idx").on(table.roomId, table.createdAt, table.id),
  // 0028: serves the per-send duplicate probe and the persisted rate window.
  index("room_messages_user_keyset_idx").on(table.roomId, table.userId, table.createdAt, table.id),
]);

export const roomMembers = roomSchema.table("members", {
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  role: roomRole("role").notNull(),
  acceptedRulesVersion: text("accepted_rules_version").notNull(),
  acceptedRulesAt: timestamp("accepted_rules_at", { withTimezone: true }).notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.userId] }),
  index("room_members_user_idx").on(table.userId),
]);

export const pointAccounts = ledgerSchema.table("point_accounts", {
  roomId: uuid("room_id").notNull(),
  userId: uuid("user_id").notNull(),
  availablePoints: numeric("available_points", { precision: 20, scale: 2 }).notNull().default("0.00"),
  frozenPoints: numeric("frozen_points", { precision: 20, scale: 2 }).notNull().default("0.00"),
  correctionDebt: numeric("correction_debt", { precision: 20, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.userId] }),
  foreignKey({ columns: [table.roomId, table.userId], foreignColumns: [roomMembers.roomId, roomMembers.userId] }).onDelete("restrict"),
  check("point_accounts_nonnegative", sql`${table.availablePoints} >= 0 AND ${table.frozenPoints} >= 0 AND ${table.correctionDebt} >= 0`),
]);

export const pointLedgerEntries = ledgerSchema.table("entries", {
  id: uuid("id").primaryKey(),
  roomId: uuid("room_id").notNull(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  availableDeltaPoints: numeric("available_delta_points", { precision: 20, scale: 2 }).notNull().default("0.00"),
  frozenDeltaPoints: numeric("frozen_delta_points", { precision: 20, scale: 2 }).notNull().default("0.00"),
  correctionDebtDeltaPoints: numeric("correction_debt_delta_points", { precision: 20, scale: 2 }).notNull().default("0.00"),
  ticketId: uuid("ticket_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  auditId: uuid("audit_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.roomId, table.userId], foreignColumns: [pointAccounts.roomId, pointAccounts.userId] }).onDelete("restrict"),
  unique("ledger_entries_idempotency_unique").on(table.idempotencyKey),
  index("ledger_entries_account_idx").on(table.roomId, table.userId, table.createdAt),
]);

export const roomAuditEvents = roomSchema.table("audit_events", {
  auditId: uuid("audit_id").primaryKey(),
  actorUserId: uuid("actor_user_id").notNull().references(() => identityUsers.id),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  result: text("result").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});
