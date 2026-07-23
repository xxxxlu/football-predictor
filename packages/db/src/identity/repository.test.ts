import { AuthError, type IdentityAccount } from "@football-predictor/domain";
import { describe, expect, it } from "vitest";

import { DrizzleIdentityRepository, type IdentityDatabase } from "./repository.js";

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
