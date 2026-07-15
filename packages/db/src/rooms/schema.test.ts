import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFile } from "node:fs/promises";
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

  it("stores public or private visibility and migrates existing rooms as private", async () => {
    expect(getTableConfig(rooms).columns.map((column) => column.name)).toContain("visibility");
    const migration = await readFile(new URL("../../migrations/0012_room_visibility.sql", import.meta.url), "utf8");
    expect(migration).toContain("room_visibility");
    expect(migration).toContain("'PUBLIC', 'PRIVATE'");
    expect(migration).toContain("DEFAULT 'PRIVATE'");
    expect(migration).toContain("DROP NOT NULL");
  });

  it("stores room ticket visibility settings with privacy-preserving defaults", async () => {
    const migration = await readFile(new URL("../../migrations/0013_room_ticket_visibility.sql", import.meta.url), "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS pre_match_stake_visible");
    expect(migration).toContain("BOOLEAN NOT NULL DEFAULT FALSE");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS post_match_ticket_visible");
    expect(migration).toContain("BOOLEAN NOT NULL DEFAULT TRUE");
  });
});
