import assert from "node:assert/strict";
import { test } from "node:test";
import { access, readFile } from "node:fs/promises";

const required = [
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/domain/package.json",
  "packages/db/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/testkit/package.json",
];

test("workspace contains every architecture boundary", async () => {
  await Promise.all(required.map((path) => access(path)));
  assert.equal(required.length, 7);
});

test("local web development loads the root server environment before Next starts", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(manifest.scripts["dev:web"], /scripts\/dev-web\.mjs/);
  const launcher = await readFile("scripts/dev-web.mjs", "utf8");
  assert.match(launcher, /loadEnvFile\("\.env"\)/);
  assert.match(launcher, /next\/dist\/bin\/next/);
  assert.match(launcher, /cwd: "apps\/web"/);
  assert.match(launcher, /"-H", "127\.0\.0\.1", "-p", "3001"/);
});
