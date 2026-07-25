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
  "render.yaml",
  "vercel.json",
  ".github/workflows/supplier-sync.yml",
];

test("workspace contains every architecture boundary", async () => {
  await Promise.all(required.map((path) => access(path)));
  assert.equal(required.length, 10);
});

test("free-tier deployment builds the web workspace and bounds the scheduled production sweep", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.devDependencies.next, "16.2.11");
  const webManifest = JSON.parse(await readFile("apps/web/package.json", "utf8"));
  assert.equal(webManifest.dependencies.next, manifest.devDependencies.next, "web must build with the same next the workspace pins");
  assert.equal(webManifest.scripts["build:packages"], "pnpm --dir ../.. build:packages");
  const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.equal(vercel.framework, "nextjs");
  assert.match(vercel.buildCommand, /build:packages/);
  assert.match(vercel.buildCommand, /@pulse\/web build/);
  assert.equal(vercel.outputDirectory, "apps/web/.next");

  const workflow = await readFile(".github/workflows/supplier-sync.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "17 \*\/2 \* \* \*"/);
  assert.match(workflow, /pnpm db:migrate/);
  assert.match(workflow, /pnpm supplier:sweep/);
  // The sweep is the only production automation: without the F1 result import,
  // F1 tickets stay pending until somebody runs the script by hand.
  assert.match(workflow, /pnpm db:import:f1-results-2026/);
  // A finished competition makes every run a no-op, so the schedule must name a
  // live season explicitly instead of relying on whatever the default once was.
  assert.match(workflow, /OPENLIGADB_COMPETITIONS:/);
  assert.doesNotMatch(workflow, /wm26/, "the World Cup ended 2026-07-19");
  for (const secret of ["DATABASE_URL", "THE_ODDS_API_KEY"]) {
    assert.ok(workflow.includes(secret + ": ${{ secrets." + secret + " }}"));
  }
});

test("production blueprint gates web and worker deploys on passing CI", async () => {
  const blueprint = await readFile("render.yaml", "utf8");
  assert.match(blueprint, /type: web[\s\S]*dockerfilePath: \.\/Dockerfile\.web/);
  assert.match(blueprint, /type: worker[\s\S]*dockerfilePath: \.\/Dockerfile\.worker/);
  assert.equal((blueprint.match(/autoDeployTrigger: checksPass/g) ?? []).length, 2);
  assert.match(blueprint, /healthCheckPath: \/api\/health\/ready/);
  assert.match(blueprint, /fromDatabase:[\s\S]*property: connectionString/);
  for (const secret of ["API_FOOTBALL_KEY", "SUPER_ADMIN_1_PASSWORD", "SUPER_ADMIN_2_PASSWORD"]) {
    assert.match(blueprint, new RegExp(`key: ${secret}\\n\\s+sync: false`));
  }
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
