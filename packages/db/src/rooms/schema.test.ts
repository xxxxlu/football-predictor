import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFile } from "node:fs/promises";
import { pointAccounts, pointLedgerEntries, roomAuditEvents, roomMembers, roomMessages, rooms } from "./schema.js";

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

  it("indexes room.rooms for the paged lobby and for the per-owner creation guards", async () => {
    const indexNames = getTableConfig(rooms).indexes.map((idx) => idx.config.name);
    // The lobby pages on (created_at, id), so the discovery index carries id.
    expect(indexNames).toContain("room_public_discovery_keyset_idx");
    // Both creation guards read room.rooms itself — no separate event ledger.
    expect(indexNames).toContain("room_owner_creation_idx");
    expect(indexNames).not.toContain("room_public_discovery_idx");

    const migration = await readFile(new URL("../../migrations/0031_room_creation_quota.sql", import.meta.url), "utf8");
    expect(migration).toContain('"visibility", "status", "created_at", "id"');
    expect(migration).toContain('"created_by", "created_at"');
    // Superseded, and dropped only after its replacement exists.
    expect(migration.indexOf("room_public_discovery_keyset_idx")).toBeLessThan(migration.indexOf('DROP INDEX IF EXISTS "room"."room_public_discovery_idx"'));
  });

  it("stores room ticket visibility settings with privacy-preserving defaults", async () => {
    const migration = await readFile(new URL("../../migrations/0013_room_ticket_visibility.sql", import.meta.url), "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS pre_match_stake_visible");
    expect(migration).toContain("BOOLEAN NOT NULL DEFAULT FALSE");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS post_match_ticket_visible");
    expect(migration).toContain("BOOLEAN NOT NULL DEFAULT TRUE");
  });
});

describe("room public chat schema (Story 12.3)", () => {
  it("stores immutable messages: author, body, timestamp — and nothing that lets them change", () => {
    const messages = getTableConfig(roomMessages);
    const columnNames = messages.columns.map((column) => column.name);
    // Exact shape: immutability is structural, so no edited_at/deleted_at column
    // can ever be reached for. Visibility changes live in room.message_moderation.
    expect(columnNames.sort()).toEqual(["body", "created_at", "id", "room_id", "user_id"]);
    expect(messages.indexes.map((idx) => idx.config.name)).toContain("room_messages_keyset_idx");
    // 0028: the duplicate probe and rate window filter by user too.
    expect(messages.indexes.map((idx) => idx.config.name)).toContain("room_messages_user_keyset_idx");
  });

  it("migration 0028 gives the send gates a user-scoped keyset index", async () => {
    const migration = await readFile(new URL("../../migrations/0028_epic12_review_closeout.sql", import.meta.url), "utf8");
    expect(migration).toContain('"room_messages_user_keyset_idx"');
    expect(migration).toContain('"room_id", "user_id", "created_at" DESC, "id" DESC');
  });

  it("holds one pinned message per room on the room row itself", () => {
    const columnNames = getTableConfig(rooms).columns.map((column) => column.name);
    expect(columnNames).toEqual(expect.arrayContaining(["pinned_message_id", "pinned_by", "pinned_at"]));
  });

  it("migration 0025 creates the table, the keyset index, the pin, and the report FK", async () => {
    const migration = await readFile(new URL("../../migrations/0025_room_chat.sql", import.meta.url), "utf8");
    const statements = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS "room"."messages"');
    // Body bounds enforced in the same unit the domain counts (code points).
    expect(statements).toContain('char_length("body") BETWEEN 1 AND 500');
    expect(statements).toContain('"room_messages_keyset_idx"');
    expect(statements).toContain('"created_at" DESC, "id" DESC');
    expect(statements).toContain('"rooms_pinned_message_fk"');
    expect(statements).toContain("ON DELETE SET NULL");
    // Deferred-work ①: message reports now reference a real message row.
    expect(statements).toContain('"reports_message_fk"');
    expect(statements).toContain('REFERENCES "room"."messages"("id") ON DELETE RESTRICT');
    // Messages are never edited or deleted — the migration must not smuggle in
    // any mutation affordance, and message rows must survive room closure.
    expect(statements).not.toMatch(/edited_at|deleted_at|is_deleted/);
    const messagesTable = statements.slice(statements.indexOf('"room"."messages" ('), statements.indexOf(");"));
    expect(messagesTable).toContain('REFERENCES "room"."rooms"("id") ON DELETE RESTRICT');
  });

  it("owner mutes reuse room.member_mutes: report_id has been nullable since 0021", async () => {
    const migration = await readFile(new URL("../../migrations/0021_governance_inbox.sql", import.meta.url), "utf8");
    const memberMutes = migration.slice(migration.indexOf("member_mutes"));
    const reportIdLine = memberMutes.split("\n").find((line) => line.includes('"report_id"'))!;
    expect(reportIdLine).not.toContain("NOT NULL");
  });
});
