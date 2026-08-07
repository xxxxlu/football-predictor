import { boolean, index, jsonb, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { identityUsers } from "../identity/schema.js";

export const privacySchema = pgSchema("privacy");

export const dataType = privacySchema.enum("data_type", ["PHOTO", "LOCATION", "DEVICE_INFO", "PREFERENCES"]);

/**
 * User consent records — one row per user per data type.
 * consent is the user's explicit authorization for each data type.
 */
export const privacyConsent = privacySchema.table("consent", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  dataType: dataType("data_type").notNull(),
  consented: boolean("consented").notNull().default(false),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("privacy_consent_user_data_type_unique").on(table.userId, table.dataType),
  index("privacy_consent_user_idx").on(table.userId),
]);

/**
 * Collected data records — each row is one piece of collected data.
 * Only stored when the user has active consent for that data type.
 */
export const collectedData = privacySchema.table("collected_data", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "cascade" }),
  dataType: dataType("data_type").notNull(),
  consentId: uuid("consent_id").notNull().references(() => privacyConsent.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("privacy_collected_data_user_idx").on(table.userId),
  index("privacy_collected_data_type_idx").on(table.dataType),
]);
