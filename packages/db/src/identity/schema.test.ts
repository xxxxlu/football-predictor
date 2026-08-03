import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { accessEvents, adminAccountAuditEvents, authAttempts, friendRequestEvents, friendships, identityUsers, operatorRoleGrants, presenceSignals, reauthProofs, ruleAcceptances, sessions, userBlocks } from "./schema.js";

describe("identity database schema", () => {
  it("keeps credentials and sessions as hashes with unique account identity", () => {
    const users = getTableConfig(identityUsers);
    expect(users.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["username_canonical", "password_hash", "recovery_code_hash", "status"]));
    expect(users.uniqueConstraints.some((constraint) => constraint.columns.some((column) => column.name === "username_canonical"))).toBe(true);
    expect(getTableConfig(sessions).columns.map((column) => column.name)).toContain("token_hash");
  });

  it("tracks super-admin idle activity, short-lived re-auth proofs, and account status audit events", () => {
    expect(getTableConfig(sessions).columns.map((column) => column.name)).toContain("last_seen_at");
    expect(getTableConfig(reauthProofs).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["token_hash", "session_token_hash", "expires_at"]));
    expect(getTableConfig(adminAccountAuditEvents).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["audit_id", "actor_user_id", "target_user_id", "action", "result", "occurred_at"]));
  });

  it("persists versioned rule consent and login/recovery failures", () => {
    expect(getTableConfig(ruleAcceptances).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["rules_version", "accepted_at", "is_adult_confirmed"]));
    expect(getTableConfig(authAttempts).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["kind", "account_key", "source_key", "occurred_at"]));
  });

  it("stores restricted operator duties as revocable grants with an audit-friendly shape", () => {
    const grants = getTableConfig(operatorRoleGrants);
    expect(grants.schema).toBe("identity");
    expect(grants.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["user_id", "role", "granted_by", "granted_at", "revoked_by", "revoked_at"]));
    // A revoked grant is kept for the trail, so the "one live grant" rule has to be a partial unique index.
    const active = grants.indexes.find((entry) => entry.config.name === "identity_operator_role_grants_active_idx");
    expect(active?.config.unique).toBe(true);
    expect(active?.config.where).toBeDefined();
    expect(active?.config.columns.map((column) => (column as { name?: string }).name)).toEqual(["user_id", "role"]);
    // The duty enum must not be able to express a third super-admin.
    expect(grants.columns.find((column) => column.name === "role")?.enumValues).toEqual(["OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"]);
    expect(getTableConfig(adminAccountAuditEvents).columns.map((column) => column.name)).toContain("metadata");
  });

  it("keeps migration 0019 idempotent and pins the super-admin pair in the database", async () => {
    const migration = await readFile(new URL("../../migrations/0019_operator_roles.sql", import.meta.url), "utf8");
    // Re-running the migration must be a no-op on every object it creates.
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS \"identity\".\"operator_role_grants\"");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS \"identity_operator_role_grants_active_idx\"");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS \"metadata\"");
    expect(migration).toContain("EXCEPTION WHEN duplicate_object THEN NULL");
    expect(migration).toContain("DROP TRIGGER IF EXISTS");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION");
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS "admin_account_audit_events_action_check"/);
    // Widened rather than replaced: the existing account actions must survive.
    expect(migration).toMatch(/CHECK \("action" IN \('ACCOUNT_DISABLED','ACCOUNT_RESTORED','OPERATOR_ROLE_GRANTED','OPERATOR_ROLE_REVOKED'\)\)/);
    // FR80 backstop plus the no-self-grant guard, enforced by the database itself.
    expect(migration).toMatch(/IF super_admins > 2 THEN/);
    expect(migration).toContain("CHECK (\"granted_by\" <> \"user_id\")");
    // The grantable duties never include a super-admin.
    expect(migration).toContain("'OPERATIONS_ADMIN', 'COMMUNITY_MODERATOR'");
    expect(migration).not.toMatch(/is_super_admin\s*=\s*true/);
  });

  it("stores friendships as one canonical pair row with directional blocks alongside", () => {
    const pairs = getTableConfig(friendships);
    expect(pairs.schema).toBe("identity");
    expect(pairs.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_lo_id", "user_hi_id", "status", "requested_by", "created_at", "responded_at"]),
    );
    expect(pairs.uniqueConstraints.some((constraint) => constraint.name === "friendships_pair_unique")).toBe(true);
    const blocks = getTableConfig(userBlocks);
    expect(blocks.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["blocker_user_id", "blocked_user_id", "created_at"]),
    );
    // Blocks carry no reason/status/visibility column: nothing to leak to the blocked side.
    expect(blocks.columns).toHaveLength(3);
  });

  it("keeps presence as consent toggles defaulting OFF plus TTL-filtered heartbeats", () => {
    const users = getTableConfig(identityUsers);
    for (const name of ["show_online_to_friends", "show_lobby_to_friends"]) {
      const column = users.columns.find((entry) => entry.name === name);
      expect(column?.notNull).toBe(true);
      expect(column?.default).toBe(false);
    }
    const signals = getTableConfig(presenceSignals);
    expect(signals.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_id", "online_beat_at", "lobby_beat_at", "updated_at"]),
    );
    // Rate limiting is persisted counting, never an in-memory counter — and
    // since 0027 the same ledger carries a kind so blocks are throttled too.
    expect(getTableConfig(friendRequestEvents).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["requester_user_id", "kind", "occurred_at"]),
    );
    expect(getTableConfig(friendRequestEvents).indexes.map((idx) => idx.config.name)).toContain(
      "friend_request_events_requester_kind_time_idx",
    );
  });

  it("migration 0027 splits the quota ledger by kind and 0028 retires the superseded index", async () => {
    const hardening = await readFile(new URL("../../migrations/0027_social_hardening.sql", import.meta.url), "utf8");
    expect(hardening).toContain('ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT \'FRIEND_REQUEST\'');
    expect(hardening).toContain("CHECK (\"kind\" IN ('FRIEND_REQUEST', 'BLOCK'))");
    expect(hardening).toContain('"friend_request_events_requester_kind_time_idx"');
    const closeout = await readFile(new URL("../../migrations/0028_epic12_review_closeout.sql", import.meta.url), "utf8");
    expect(closeout).toContain('DROP INDEX IF EXISTS "identity"."friend_request_events_requester_time_idx"');
  });

  it("keeps migration 0023 idempotent with pair canonicalisation enforced by the database", async () => {
    const migration = await readFile(new URL("../../migrations/0023_social_foundation.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "identity"."friendships"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "identity"."user_blocks"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "identity"."presence_signals"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "identity"."friend_request_events"');
    // The database — not application code — arbitrates pair identity and self-relations.
    expect(migration).toContain('CHECK ("user_lo_id" < "user_hi_id")');
    expect(migration).toContain('UNIQUE ("user_lo_id", "user_hi_id")');
    expect(migration).toContain('CHECK ("blocker_user_id" <> "blocked_user_id")');
    expect(migration).toContain('CHECK ("requested_by" IN ("user_lo_id", "user_hi_id"))');
    expect(migration).toMatch(/CHECK \(\("status" = 'ACCEPTED'\) = \("responded_at" IS NOT NULL\)\)/);
    // Privacy toggles must default OFF at the database layer (FR85).
    expect(migration).toMatch(/"show_online_to_friends" boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/"show_lobby_to_friends" boolean NOT NULL DEFAULT false/);
    // Physical isolation: the SQL itself (comments stripped) must never touch reward-side schemas.
    const sqlOnly = migration.replace(/--[^\n]*/g, "");
    expect(sqlOnly).not.toMatch(/"room"\.|"predictions"\.|balance|ledger|settle/i);
  });

  it("stores registration/login audience context without device fingerprint identifiers", () => {
    const columns = getTableConfig(accessEvents).columns.map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["user_id", "kind", "ip_address", "country_code", "region", "city", "device_class", "os", "browser", "occurred_at"]));
    expect(columns).not.toEqual(expect.arrayContaining(["fingerprint", "device_id", "latitude", "longitude"]));
  });
});
