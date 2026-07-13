import assert from "node:assert/strict";
import { test } from "node:test";
import { access } from "node:fs/promises";

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
