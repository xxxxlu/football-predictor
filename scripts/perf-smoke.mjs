#!/usr/bin/env node
// Story 7.5 / NFR1-NFR3 gate G5 — performance SMOKE (NOT a load test).
//
// Measures p95 latency of a few cached/read endpoints with sequential GETs and fails (exit 1) only
// if p95 exceeds a deliberately GENEROUS ceiling or a probed endpoint errors. This is a fast
// regression tripwire for gross latency/availability breakage — it does NOT establish NFR1
// (field LCP/INP/CLS) or NFR2/NFR4 (p95 ≤ 800ms under 20-concurrent load). Those require a real
// load environment and remain documented gaps for Story 7.5.
//
// Usage:
//   node scripts/perf-smoke.mjs https://football-predictor-web.onrender.com
//   PERF_SMOKE_BASE_URL=https://... node scripts/perf-smoke.mjs
//   PERF_SMOKE_COOKIE="fp_session=..." node scripts/perf-smoke.mjs   # also probes /api/v1/matches
// Defaults to the local dev server when no target is provided.

import process from "node:process";

const rawBase = process.argv[2] || process.env.PERF_SMOKE_BASE_URL || "http://127.0.0.1:3001";
const baseUrl = rawBase.replace(/\/+$/, "");
const iterations = Math.max(1, Number(process.env.PERF_SMOKE_ITERATIONS || 20));
const p95CeilingMs = Number(process.env.PERF_SMOKE_P95_MS || 2000);
const timeoutMs = Number(process.env.PERF_SMOKE_TIMEOUT_MS || 15000);
const cookie = process.env.PERF_SMOKE_COOKIE || "";

// Anonymous-safe read endpoints by default. /api/v1/matches is private (401 without a session), so it
// is only probed when PERF_SMOKE_COOKIE is supplied.
const endpoints = [
  { path: "/", expect: 200 },
  { path: "/api/health/ready", expect: 200 },
  { path: "/api/health/live", expect: 200 },
];
if (cookie) endpoints.push({ path: "/api/v1/matches", expect: 200, authed: true });

async function timedGet(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const headers = { accept: "*/*" };
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, { method: "GET", redirect: "manual", headers, signal: controller.signal });
    await response.arrayBuffer(); // drain the body so timing includes full transfer
    return { status: response.status, ms: performance.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

function p95(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  console.log(`Perf smoke ${baseUrl} — ${iterations} sequential GETs/endpoint, p95 ceiling ${p95CeilingMs}ms`);
  console.log("NOTE: smoke tripwire only — does NOT assert NFR1 (field perf) or NFR2/NFR4 (p95 under load).\n");

  const failures = [];
  for (const endpoint of endpoints) {
    const durations = [];
    let statusError = "";
    for (let i = 0; i < iterations; i += 1) {
      try {
        const { status, ms } = await timedGet(endpoint.path);
        durations.push(ms);
        if (status !== endpoint.expect) { statusError = `status ${status} (expected ${endpoint.expect})`; break; }
      } catch (error) {
        statusError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    if (statusError) {
      failures.push(`${endpoint.path}: ${statusError}`);
      console.log(`FAIL  ${endpoint.path}  — ${statusError}`);
      continue;
    }

    const value = p95(durations);
    const min = Math.min(...durations);
    const ok = value <= p95CeilingMs;
    if (!ok) failures.push(`${endpoint.path}: p95 ${value.toFixed(0)}ms > ${p95CeilingMs}ms`);
    console.log(`${ok ? "PASS" : "FAIL"}  ${endpoint.path}  — p95 ${value.toFixed(0)}ms (min ${min.toFixed(0)}ms, n=${durations.length})${endpoint.authed ? " [authed]" : ""}`);
  }

  console.log(`\n${endpoints.length - failures.length}/${endpoints.length} endpoints within ceiling.`);
  if (failures.length > 0) {
    console.error(`\nPerf smoke FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\nPerf smoke passed against ${baseUrl}.`);
}

main().catch((error) => {
  console.error(`Perf smoke crashed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
