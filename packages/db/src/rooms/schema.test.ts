import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { pointAccounts, pointLedgerEntries, roomAuditEvents, roomMembers, rooms } from "./schema.js";

describe("private room schema", () => {
  it("uses compound membership and point-account keys to isolate every room", () => {
    const membership = getTableConfig(roomMembers);
    const accounts = getTableConfig(pointAccounts);
    expect(membership.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["room_id", "user_id"]);
    expect(accounts.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["room_id", "user_id"]);
    expect(accounts.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["available_points", "frozen_points", "correction_debt"]));
  });

  it("stores invite hashes, versioned consent, the initial grant ledger, and audit identifiers", () => {
    expect(getTableConfig(rooms).columns.map((column) => column.name)).toContain("invite_token_hash");
    expect(getTableConfig(roomMembers).columns.map((column) => column.name)).toContain("accepted_rules_version");
    expect(getTableConfig(pointLedgerEntries).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["kind", "amount", "audit_id"]));
    expect(getTableConfig(roomAuditEvents).columns.map((column) => column.name)).toContain("audit_id");
  });
});
