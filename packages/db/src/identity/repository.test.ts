import { AuthError, type IdentityAccount } from "@pulse/domain";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { activeOperatorRoles, DrizzleIdentityRepository, type IdentityDatabase } from "./repository.js";
import { identityUsers } from "./schema.js";

// Regression guard for the CI-caught bug where a duplicate username registration returned 500
// (INTERNAL_ERROR) instead of a friendly 409 USERNAME_UNAVAILABLE: isUniqueViolation only checked the
// top-level `.code`, so a WRAPPED Postgres error (real error on `.cause`) slipped through. These drive
// the real createRegisteredAccount catch path with a db whose transaction throws various error shapes —
// no live Postgres required. See repository.ts:isUniqueViolation.

// createRegisteredAccount rejects inside db.transaction(), so the account fields are never read; a cast
// keeps the test focused on error mapping rather than on constructing a full account.
const ACCOUNT = {} as unknown as IdentityAccount;

function dbThatThrows(error: unknown): IdentityDatabase {
  return {
    transaction: async () => {
      throw error;
    },
  } as unknown as IdentityDatabase;
}

describe("DrizzleIdentityRepository.createRegisteredAccount unique-violation mapping", () => {
  it("maps a top-level 23505 to USERNAME_UNAVAILABLE (409)", async () => {
    const repo = new DrizzleIdentityRepository(dbThatThrows(Object.assign(new Error("dup"), { code: "23505" })));
    await expect(repo.createRegisteredAccount(ACCOUNT)).rejects.toMatchObject({
      code: "USERNAME_UNAVAILABLE",
      status: 409,
    });
  });

  it("maps a WRAPPED 23505 (code on .cause) to USERNAME_UNAVAILABLE — the CI-500 regression", async () => {
    const wrapped = Object.assign(new Error("Failed query: insert into identity_users ..."), {
      cause: Object.assign(new Error("duplicate"), { code: "23505" }),
    });
    const repo = new DrizzleIdentityRepository(dbThatThrows(wrapped));
    await expect(repo.createRegisteredAccount(ACCOUNT)).rejects.toMatchObject({
      code: "USERNAME_UNAVAILABLE",
      status: 409,
    });
  });

  it("maps a duplicate-key message with no code to USERNAME_UNAVAILABLE", async () => {
    const byMessage = new Error(
      'duplicate key value violates unique constraint "identity_users_username_canonical_unique"',
    );
    const repo = new DrizzleIdentityRepository(dbThatThrows(byMessage));
    await expect(repo.createRegisteredAccount(ACCOUNT)).rejects.toBeInstanceOf(AuthError);
    await expect(repo.createRegisteredAccount(ACCOUNT)).rejects.toMatchObject({ code: "USERNAME_UNAVAILABLE" });
  });

  it("rethrows a non-unique error unchanged (not mapped to an AuthError)", async () => {
    const other = Object.assign(new Error("connection terminated"), { code: "08006" });
    const repo = new DrizzleIdentityRepository(dbThatThrows(other));
    await expect(repo.createRegisteredAccount(ACCOUNT)).rejects.toThrow("connection terminated");
    await expect(repo.createRegisteredAccount(ACCOUNT)).rejects.not.toBeInstanceOf(AuthError);
  });
});

// The operator-duty subquery is correlated against identity.users. Drizzle renders
// an embedded column unqualified inside a subquery, and both tables carry an
// `id`/`user_id`, so interpolating the column objects produced `"user_id" = "id"`
// — a self-comparison within the grants table that matched nothing and reported
// every operator as having no duties. postgres.js connects lazily, so rendering the
// statement needs no database.
describe("active operator duties subquery", () => {
  const rendered = drizzle(postgres("postgres://verify@127.0.0.1:1/verify"))
    .select({ isSuperAdmin: identityUsers.isSuperAdmin, roles: activeOperatorRoles })
    .from(identityUsers)
    .toSQL().sql;

  it("correlates on the outer users row, fully qualified", () => {
    expect(rendered).toContain('g.user_id = "identity"."users"."id"');
    expect(rendered).not.toMatch(/"user_id"\s*=\s*"id"/);
  });

  it("reads only live grants, from the grants table under its own alias", () => {
    expect(rendered).toContain("FROM identity.operator_role_grants g");
    expect(rendered).toContain("g.revoked_at IS NULL");
    expect(rendered).toContain("array_agg(g.role ORDER BY g.role)");
  });
});
