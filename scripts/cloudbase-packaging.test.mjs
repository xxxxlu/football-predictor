import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hoistCloudBaseNativePackages } from "./cloudbase-packaging.mjs";

test("hoists Next's traced Argon2 alias where CloudBase preserves node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "football-cloudbase-package-"));
  const alias = "argon2-cab5f917f164e3dd";
  const source = join(root, "node_modules/.pnpm/@node-rs+argon2/node_modules/@node-rs/argon2");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "@node-rs/argon2" }));
  await writeFile(join(source, "index.js"), "module.exports = {};\n");
  const tracedScope = join(root, "apps/web/.next/node_modules/@node-rs");
  await mkdir(tracedScope, { recursive: true });
  await symlink(source, join(tracedScope, alias), "dir");

  assert.deepEqual(await hoistCloudBaseNativePackages(root), [alias]);
  assert.equal(
    await readFile(join(root, "apps/web/node_modules/@node-rs", alias, "index.js"), "utf8"),
    "module.exports = {};\n",
  );
});
