import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { adminAccountAuditEvents, authAttempts, identityUsers, reauthProofs, ruleAcceptances, sessions } from "./schema.js";

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
});
