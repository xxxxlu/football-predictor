import { index, integer, numeric, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { identityUsers } from "../identity/schema.js";
import { rooms } from "../rooms/schema.js";

export const predictionSchema = pgSchema("prediction");

export const predictionTickets = predictionSchema.table("tickets", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => identityUsers.id, { onDelete: "restrict" }),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "restrict" }),
  marketId: text("market_id").notNull(),
  fixtureId: text("fixture_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  stakePoints: numeric("stake_points", { precision: 20, scale: 2 }).notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("prediction_ticket_idempotency_unique").on(table.userId, table.roomId, table.idempotencyKey),
  index("prediction_tickets_room_user_idx").on(table.roomId, table.userId, table.createdAt),
  index("prediction_tickets_fixture_idx").on(table.fixtureId, table.status),
]);

export const predictionLegs = predictionSchema.table("legs", {
  ticketId: uuid("ticket_id").notNull().references(() => predictionTickets.id, { onDelete: "restrict" }),
  legNumber: integer("leg_number").notNull(),
  selection: text("selection").notNull(),
  oddsVersion: text("odds_version").notNull(),
  decimalOdds: text("decimal_odds").notNull(),
  dataAsOf: timestamp("data_as_of", { withTimezone: true }).notNull(),
  supplier: text("supplier").notNull(),
  supplierFixtureId: integer("supplier_fixture_id").notNull(),
  bookmakerId: integer("bookmaker_id").notNull(),
  supplierMarketId: integer("supplier_market_id").notNull(),
}, (table) => [primaryKey({ columns: [table.ticketId, table.legNumber] })]);
