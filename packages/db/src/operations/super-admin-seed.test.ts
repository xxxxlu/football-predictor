import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("super-admin seed CLI", () => {
  it("requires exactly two environment-provided credentials and Argon2", async () => {
    const source = await readFile(new URL("../../scripts/seed-super-admins.mjs", import.meta.url), "utf8");
    for (const key of ["SUPER_ADMIN_1_USERNAME", "SUPER_ADMIN_1_PASSWORD", "SUPER_ADMIN_2_USERNAME", "SUPER_ADMIN_2_PASSWORD"]) expect(source).toContain(key);
    expect(source).toContain("@node-rs/argon2");
    expect(source).not.toMatch(/password\s*:\s*["'][^"']+["']/i);
  });
});
