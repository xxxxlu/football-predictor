import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { predictionLegs, predictionTickets } from "./schema.js";
import { pointLedgerEntries } from "../rooms/schema.js";

describe("prediction persistence schema", () => {
  it("enforces idempotency per user and room and keeps immutable odds evidence", () => {
    const tickets = getTableConfig(predictionTickets);
    expect(tickets.uniqueConstraints.some((constraint) => constraint.columns.map((column) => column.name).join(",") === "user_id,room_id,idempotency_key")).toBe(true);
    expect(getTableConfig(predictionLegs).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["odds_version", "decimal_odds", "data_as_of", "supplier", "supplier_fixture_id", "bookmaker_id", "supplier_market_id"]));
  });

  it("links the freeze ledger to ticket and stores both balance deltas", () => {
    expect(getTableConfig(pointLedgerEntries).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["ticket_id", "available_delta_points", "frozen_delta_points"]));
  });
});
