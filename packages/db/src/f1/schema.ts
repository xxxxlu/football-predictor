import { boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { identityUsers } from "../identity/schema.js";

export const f1Schema = pgSchema("f1");

export const f1Constructors = f1Schema.table("constructors", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const f1Drivers = f1Schema.table("drivers", {
  code: text("code").primaryKey(),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  constructorKey: text("constructor_key").notNull().references(() => f1Constructors.key, { onDelete: "restrict" }),
  active: boolean("active").notNull().default(true),
  seasonPoints: integer("season_points").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const f1RaceWeekends = f1Schema.table("race_weekends", {
  id: uuid("id").primaryKey(),
  season: integer("season").notNull(),
  round: integer("round").notNull(),
  name: text("name").notNull(),
  circuitKey: text("circuit_key").notNull(),
  isSprintWeekend: boolean("is_sprint_weekend").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("f1_race_weekends_season_round_unique").on(table.season, table.round),
]);

export const f1Sessions = f1Schema.table("sessions", {
  id: uuid("id").primaryKey(),
  weekendId: uuid("weekend_id").notNull().references(() => f1RaceWeekends.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  state: text("state").notNull().default("UPCOMING"),
  resultVersion: integer("result_version"),
  resultConfirmed: boolean("result_confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("f1_sessions_weekend_kind_unique").on(table.weekendId, table.kind),
  index("f1_sessions_starts_at_idx").on(table.startsAt),
]);

export const f1Markets = f1Schema.table("markets", {
  id: text("id").primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => f1Sessions.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("OPEN"),
  currentVersion: text("current_version"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("f1_markets_session_kind_unique").on(table.sessionId, table.kind),
]);

export const f1MarketOdds = f1Schema.table("market_odds", {
  marketId: text("market_id").notNull().references(() => f1Markets.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  dataAsOf: timestamp("data_as_of", { withTimezone: true }).notNull(),
  outcomes: jsonb("outcomes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.marketId, table.version] })]);

export const f1SessionResults = f1Schema.table("session_results", {
  sessionId: uuid("session_id").notNull().references(() => f1Sessions.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  classification: jsonb("classification").notNull(),
  enteredBy: uuid("entered_by").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.sessionId, table.version] })]);
