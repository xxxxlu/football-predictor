#!/usr/bin/env node
// Production smoke test: exercises the deployed web service over HTTP and fails
// the process (exit 1) if any public contract regresses. Safe to run repeatedly
// against any environment; performs only anonymous GETs and never mutates state.
//
// Usage:
//   node scripts/smoke-test.mjs https://pulse-web.onrender.com
//   SMOKE_BASE_URL=https://... node scripts/smoke-test.mjs
// Defaults to the local dev server when no target is provided.

import process from "node:process";

const rawBase = process.argv[2] || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3001";
const baseUrl = rawBase.replace(/\/+$/, "");
const isHttps = baseUrl.startsWith("https://");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

const results = [];
const pass = (name, detail = "") => results.push({ name, ok: true, detail });
const fail = (name, detail = "") => results.push({ name, ok: false, detail });

async function request(path, { method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { method, redirect: "manual", headers: { accept: "*/*" }, signal: controller.signal });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { response, text, json };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, fn) {
  try {
    await fn();
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log(`Smoke testing ${baseUrl} (https=${isHttps}, timeout=${timeoutMs}ms)\n`);

  await check("GET / returns 200", async () => {
    const { response } = await request("/");
    if (response.status === 200) pass("GET / returns 200", "200");
    else fail("GET / returns 200", `expected 200, got ${response.status}`);
  });

  await check("GET /api/health/live returns 200 live", async () => {
    const { response, json } = await request("/api/health/live");
    if (response.status === 200 && json?.data?.status === "live") pass("GET /api/health/live returns 200 live", `status=${json?.data?.status}`);
    else fail("GET /api/health/live returns 200 live", `status=${response.status} body.status=${json?.data?.status ?? "?"}`);
  });

  await check("GET /api/health/ready returns 200 ready", async () => {
    const { response, json } = await request("/api/health/ready");
    if (response.status === 200 && json?.data?.status === "ready") pass("GET /api/health/ready returns 200 ready", `checks=${(json?.data?.checks ?? []).map((c) => c.name).join(",")}`);
    else fail("GET /api/health/ready returns 200 ready", `status=${response.status} body.status=${json?.data?.status ?? "?"}`);
  });

  await check("anonymous GET /api/v1/auth/session returns 401", async () => {
    const { response, json } = await request("/api/v1/auth/session");
    if (response.status === 401 && json?.error?.code === "UNAUTHENTICATED") pass("anonymous GET /api/v1/auth/session returns 401", "401 UNAUTHENTICATED");
    else fail("anonymous GET /api/v1/auth/session returns 401", `expected 401 UNAUTHENTICATED, got ${response.status} ${json?.error?.code ?? ""}`);
  });

  await check("security response headers present", async () => {
    const { response } = await request("/");
    const h = response.headers;
    const required = [
      ["content-security-policy", (v) => v?.includes("default-src 'self'")],
      ["x-content-type-options", (v) => v === "nosniff"],
      ["referrer-policy", (v) => Boolean(v)],
      ["permissions-policy", (v) => Boolean(v)],
      ["x-frame-options", (v) => v === "DENY"],
    ];
    if (isHttps) required.push(["strict-transport-security", (v) => Boolean(v) && v.includes("max-age=")]);
    const missing = [];
    for (const [name, ok] of required) {
      if (!ok(h.get(name) ?? undefined)) missing.push(`${name}=${h.get(name) ?? "<absent>"}`);
    }
    if (missing.length === 0) pass("security response headers present", `${required.length} headers ok${isHttps ? " (incl. HSTS)" : ""}`);
    else fail("security response headers present", `missing/invalid: ${missing.join("; ")}`);
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

  if (failed.length > 0) {
    console.error(`\nSmoke test FAILED: ${failed.length} check(s) failed against ${baseUrl}.`);
    process.exit(1);
  }
  console.log(`\nSmoke test passed against ${baseUrl}.`);
}

main().catch((error) => {
  console.error(`Smoke test crashed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
